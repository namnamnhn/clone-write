// Sửa nhanh 1 đoạn text ngắn theo yêu cầu tuỳ chỉnh (dùng trong luồng Smart Fix / sửa nhanh).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchDeepSeek } from '../../api/deepseek';
import { TranslationTier } from '../../../types';
import { getEffectiveModelsForTier } from './modelSelection';

export const smartFixChunk = async (
    inputs: string,
    userPrompt: string,
    tier: TranslationTier,
    onLog?: (msg: string) => void,
    enabledModels?: string[],
    shouldAbort?: () => boolean,
    imageBase64?: string,
    deepseekKey?: string
): Promise<{ find: string, replace: string }[]> => {
    // RULE: Use Pro models for smart_fix to ensure highest quality as user requested, except in Lite mode
    const modelsToUse = getEffectiveModelsForTier(tier, 'smart_fix', enabledModels);

    const systemInstruction = `Bạn là một hệ thống phân tích và trích xuất quy tắc sửa lỗi văn bản truyện dịch.
Người dùng sẽ đưa ra một YÊU CẦU SỬA LỖI cụ thể.
Nếu người dùng cung cấp ẢNH MINH HỌA LỖI, hãy xem xét ảnh đó để hiểu rõ hơn lỗi mà người dùng đang gặp phải (ví dụ: lỗi hiển thị, lỗi ngữ cảnh, lỗi dịch sai từ ngữ cụ thể trong ảnh).
Nhiệm vụ của bạn là:
1. Đọc kỹ YÊU CẦU SỬA LỖI và phân tích ẢNH MINH HỌA (nếu có).
2. Quét toàn bộ nội dung văn bản được cung cấp.
3. Tìm các từ, cụm từ, hoặc tên riêng bị lỗi theo yêu cầu của người dùng, và đề xuất cách sửa (thay thế bằng gì).
4. Trả về danh sách các quy tắc tìm và thay thế (find and replace) dưới dạng JSON.
{
  "rules": [
    {
      "find": "<Từ/cụm từ gốc bị lỗi trong văn bản>",
      "replace": "<Từ/cụm từ đã được sửa đúng>"
    }
  ]
}

LƯU Ý QUAN TRỌNG:
- "find" phải là chuỗi ký tự CHÍNH XÁC CÓ THẬT trong văn bản gốc. KHÔNG bao gồm các dấu câu thừa nếu không cần thiết.
- Nếu không tìm thấy lỗi nào khớp với yêu cầu, hãy trả về mảng "rules" rỗng: { "rules": [] }
- Chỉ trả về JSON, không kèm theo bất kỳ văn bản giải thích nào khác.`;

    const textPrompt = `YÊU CẦU SỬA LỖI TỪ NGƯỜI DÙNG:
"${userPrompt}"

HÃY ĐỌC KỸ YÊU CẦU TRÊN VÀ TÌM KIẾM TRONG VĂN BẢN DƯỚI ĐÂY ĐỂ TẠO QUY TẮC SỬA LỖI.

Văn bản cần phân tích:
${inputs}`;

    const contents: any = { parts: [] };
    if (imageBase64) {
        // Extract mime type and base64 data
        const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
            contents.parts.push({
                inlineData: {
                    mimeType: match[1],
                    data: match[2]
                }
            });
        }
    }
    contents.parts.push({ text: textPrompt });

    return await smartExecution(
        modelsToUse,
        async (modelId) => {
            if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
            let result = "";
            if (modelId.startsWith('deepseek:')) {
                const deepseekModelName = modelId.replace('deepseek:', '');
                let finalPrompt = textPrompt;
                if (imageBase64) {
                    finalPrompt = `[User provided an Image, but image is omitted in text mode]\n${textPrompt}`;
                }
                result = await fetchDeepSeek(deepseekKey || "", deepseekModelName, systemInstruction, finalPrompt, true);
            } else {
                const ai = getAiClient();
                const response = await ai.models.generateContent({
                    model: modelId,
                    contents: contents,
                    config: {
                        systemInstruction,
                        temperature: 0.1,
                        responseMimeType: "application/json",
                        maxOutputTokens: 65536,
                        safetySettings: SAFETY_SETTINGS
                    }
                });
                result = response.text || "";
            }
            if (!result.trim()) throw new Error("API trả về kết quả rỗng.");
            if (onLog) onLog(`[Smart Fix] AI Response Length: ${result.length}`);
            try {
                let cleanResult = result.trim();
                const jsonMatch = cleanResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    cleanResult = jsonMatch[1];
                }
                const parsed = JSON.parse(cleanResult);
                if (onLog) onLog(`[Smart Fix] Parsed ${parsed.rules?.length || 0} rules`);
                return parsed.rules || [];
            } catch (e) {
                if (onLog) onLog(`[Smart Fix] JSON Parse Error. Raw: ${result.substring(0, 200)}...`);
                throw new Error("Không thể phân tích kết quả JSON từ AI.", { cause: e });
            }
        },
        "Smart Fix Chunk",
        onLog
    );
};
