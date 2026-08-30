// Lớp API DeepSeek — "vệ tinh dự phòng" duy nhất bên cạnh Gemini chính: vừa làm tier dịch
// phụ khi người dùng chủ động chọn, vừa là phương tiện cứu hộ tự động (Safety Filter /
// hết Quota Gemini tạm thời) cho các tệp bị chặn.

import { createKeyManager, ApiKeyStatus } from './keyManagerFactory';

export type DeepSeekKeyStatus = ApiKeyStatus;

export interface DeepSeekModelDef {
    id: string;          // id gửi lên API (vd: 'deepseek-v4-flash')
    label: string;        // tên hiển thị (vd: 'DeepSeek V4 Flash (1M context, output 384K)')
    contextLength: number;
    maxOutputTokens: number;
}

export const DEEPSEEK_MODELS: DeepSeekModelDef[] = [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (1M context, output 384K)', contextLength: 1_000_000, maxOutputTokens: 384_000 },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (1M context, output 384K)', contextLength: 1_000_000, maxOutputTokens: 384_000 },
];

export const getDeepSeekModelInfo = (modelId: string): DeepSeekModelDef | null => {
    return DEEPSEEK_MODELS.find(m => m.id === modelId) || null;
};

// V4 Pro/Flash là model hybrid có chế độ "thinking" (suy luận ẩn) bật mặc định — tắt đi để
// tiết kiệm token/thời gian và tránh output lẫn phần suy luận không cần thiết cho tác vụ dịch/
// phân tích văn bản. KHÔNG áp dụng cho 'deepseek-chat' (V3, không có thinking) và cố tình
// KHÔNG áp dụng cho 'deepseek-reasoner' (R1 — bản chất là để suy luận sâu, tắt đi vô nghĩa).
const isThinkingToggleModel = (modelId: string): boolean => modelId === 'deepseek-v4-pro' || modelId === 'deepseek-v4-flash';

// TÁI CẤU TRÚC: class DeepSeekKeyManager (~150 dòng) trước đây trùng lặp logic KeyManager
// của dịch vụ vệ tinh cũ - đã gộp về keyManagerFactory.ts dùng chung (sửa lỗi xoay vòng key
// chỉ cần làm MỘT nơi). Giữ đúng tên xuất khẩu cũ để mọi nơi import không phải đổi gì.
export const deepSeekKeyManager = createKeyManager(
    'DeepSeek',
    ['429', 'rate limit', 'insufficient balance', 'too many requests']
);


const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const estimateOutputTokens = (promptLen: number, sysLen: number, modelInfo: DeepSeekModelDef | null): number => {
    const estInputTokens = Math.ceil(promptLen / 2.5) + Math.ceil(sysLen / 2.5);
    let estimatedOutputTokens = Math.min(Math.ceil(promptLen / 2.5) + 1000, 16000);
    if (modelInfo) {
        const remainingContext = modelInfo.contextLength - estInputTokens - 200;
        if (remainingContext > 0) {
            estimatedOutputTokens = Math.min(estimatedOutputTokens, remainingContext);
        }
        estimatedOutputTokens = Math.min(estimatedOutputTokens, modelInfo.maxOutputTokens);
    }
    return estimatedOutputTokens;
};

export const fetchDeepSeek = async (
    apiKeyStr: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    jsonMode = false,
    onModelInfo?: (model: string) => void
): Promise<string> => {
    deepSeekKeyManager.syncKeys(apiKeyStr);

    const keys = deepSeekKeyManager.getKeys();
    if (keys.length === 0) {
        throw new Error("DeepSeek API Key not provided.");
    }

    const modelId = model.split(',')[0].trim() || 'deepseek-v4-flash';
    const modelInfo = getDeepSeekModelInfo(modelId);
    const estimatedOutputTokens = estimateOutputTokens(prompt.length, systemInstruction.length, modelInfo);

    const payload: any = {
        model: modelId,
        messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: estimatedOutputTokens
    };

    if (jsonMode) {
        payload.response_format = { type: 'json_object' };
    }

    if (isThinkingToggleModel(modelId)) {
        payload.thinking = { type: 'disabled' };
    }

    let lastError: Error | null = null;
    const maxRetries = 7;
    let attempt = 0;

    while (attempt < maxRetries) {
        const currentKey = deepSeekKeyManager.getCurrentKey();
        try {
            const response = await fetch(DEEPSEEK_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${currentKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errObj = await response.json().catch(() => ({}));
                const errMsg = errObj.error?.message || `DeepSeek API error: ${response.status} ${response.statusText}`;
                throw new Error(errMsg);
            }

            const data = await response.json();
            if (onModelInfo) onModelInfo(modelId);
            deepSeekKeyManager.reportSuccess();
            return data.choices?.[0]?.message?.content || "";
        } catch (error: any) {
            lastError = error;
            deepSeekKeyManager.reportError(error.message);
            attempt++;

            if (attempt >= maxRetries) break;

            if (attempt === 1) {
                await delay(3000);
            } else if (attempt === 2) {
                await delay(5000);
            } else if (attempt === 3) {
                await delay(10000);
            } else {
                if (keys.length > 1) {
                    // already rotated by reportError if quota error
                } else {
                    await delay(30000);
                }
            }
        }
    }

    throw new Error(`DeepSeek failed after ${maxRetries} attempts. Last Error: ${lastError?.message}`);
};

export const fetchDeepSeekStream = async (
    apiKeyStr: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    onChunk: (text: string) => void,
    onModelInfo?: (model: string) => void,
    onLog?: (msg: string) => void
): Promise<string> => {
    deepSeekKeyManager.syncKeys(apiKeyStr);

    const keys = deepSeekKeyManager.getKeys();
    if (keys.length === 0) {
        throw new Error("DeepSeek API Key not provided.");
    }

    const modelId = model.split(',')[0].trim() || 'deepseek-v4-flash';
    const modelInfo = getDeepSeekModelInfo(modelId);

    let lastError: Error | null = null;
    const maxRetries = 7;
    let attempt = 0;
    let fullText = "";
    let isContinuation = false;

    let currentPrompt = prompt;
    let continuationAttempts = 0;
    const MAX_CONTINUATIONS = 6;

    while (attempt < maxRetries) {
        const currentKey = deepSeekKeyManager.getCurrentKey();
        try {
            if (!isContinuation) {
                fullText = "";
            }
            const estimatedOutputTokens = estimateOutputTokens(currentPrompt.length, systemInstruction.length, modelInfo);

            const response = await fetch(DEEPSEEK_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${currentKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: [
                        { role: "system", content: systemInstruction },
                        { role: "user", content: currentPrompt }
                    ],
                    stream: true,
                    temperature: 0.2,
                    max_tokens: estimatedOutputTokens,
                    ...(isThinkingToggleModel(modelId) ? { thinking: { type: 'disabled' } } : {})
                })
            });

            if (!response.ok) {
                const errObj = await response.json().catch(() => ({}));
                throw new Error(errObj.error?.message || `DeepSeek API error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error("No response body from DeepSeek.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let modelReported = false;
            let needsContinuation = false;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIdx;

                while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIdx).trim();
                    buffer = buffer.substring(newlineIdx + 1);
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr);

                            if (onModelInfo && !modelReported) {
                                onModelInfo(modelId);
                                modelReported = true;
                            }

                            const content = data.choices?.[0]?.delta?.content;
                            if (content) {
                                fullText += content;
                                onChunk(fullText);
                            }

                            if (data.choices?.[0]?.finish_reason === 'length') {
                                if (continuationAttempts < MAX_CONTINUATIONS) {
                                    continuationAttempts++;
                                    currentPrompt = `${prompt}\n\n[ĐÃ DỊCH ĐƯỢC MỘT PHẦN LÀ:\n${fullText}\n]\n\nBẠN HÃY VIẾT TIẾP CHÍNH XÁC TỪ CHỖ BỊ CẮT. KHÔNG LẶP LẠI PHẦN ĐÃ DỊCH, KHÔNG MỞ LẠI THẺ START NỮA.`;
                                    attempt = 0;
                                    deepSeekKeyManager.reportSuccess();
                                    needsContinuation = true;
                                    isContinuation = true;
                                    if (onLog) onLog(`🔄 DeepSeek bị cắt ngang (max_tokens). Tự động nối tiếp phần ${continuationAttempts}/${MAX_CONTINUATIONS}...`);
                                    break;
                                } else {
                                    throw new Error("Lỗi DeepSeek: Đã đạt giới hạn số lần nối tự động do max_tokens.");
                                }
                            }

                        } catch (e: any) {
                            if (e.message === 'ABORTED' || (e.message && e.message.includes('Lỗi AI lặp từ')) || e.message.includes('Lỗi DeepSeek:')) {
                                throw e;
                            }
                            // Ignore parse errors
                        }
                    }
                }
                if (needsContinuation) break;
            }

            if (needsContinuation) {
                continue;
            }

            deepSeekKeyManager.reportSuccess();
            return fullText;
        } catch (error: any) {
            // FIX (bug "nối tiếp bị mất đầu chương"): khi 1 lượt NỐI TIẾP (continuation) gặp lỗi
            // giữa luồng (mạng rớt/5xx/429), reset cờ isContinuation mà quên reset currentPrompt
            // khiến lần retry sau vẫn dùng prompt "HÃY VIẾT TIẾP TỪ CHỖ BỊ CẮT..." trong khi
            // fullText đã bị xoá trắng ở đầu vòng lặp -> model chỉ trả về PHẦN ĐUÔI và được trả
            // về như bản dịch hoàn chỉnh (mất toàn bộ phần đầu đã dịch trước đó). Reset cả 2 để
            // retry luôn là lượt dịch SẠCH từ đầu thay vì nối tiếp trên buffer rỗng.
            isContinuation = false;
            currentPrompt = prompt;
            if (error.message === 'ABORTED' || (error.message && error.message.includes('Lỗi AI lặp từ'))) {
                throw error;
            }
            lastError = error;
            deepSeekKeyManager.reportError(error.message);
            attempt++;

            if (attempt >= maxRetries) break;

            if (attempt === 1) {
                await delay(3000);
            } else if (attempt === 2) {
                await delay(5000);
            } else if (attempt === 3) {
                await delay(10000);
            } else {
                if (keys.length > 1) {
                    // rotated
                } else {
                    await delay(30000);
                }
            }
        }
    }

    throw new Error(`DeepSeek stream failed after ${maxRetries} attempts. Last Error: ${lastError?.message}`);
};
