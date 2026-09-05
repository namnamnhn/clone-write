import { useState, useRef } from 'react';
import { FileItem, LogContext } from '../../types';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../../services/api/gemini';
import { buildRulePreview, applyRulesToFiles, chunkRuleLines, PreviewFixRule } from '../../utils/text/ruleFixing';
import { buildStoryContextBlock } from '../../prompts';
import { chunkTextByFileBoundary } from '../../utils/fileHelpers';
import { ANALYSIS_CHUNK_MAX_CHARS } from '../../constants';

export interface UseSinoVietnameseFixerPageProps {
    files: FileItem[];
    setFilesSafe: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
    handleTranslatedFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSyncSupportInfo?: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    handleExportSupportInfo?: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    state: any;
    setState: any;
    storyInfo?: any;
    promptTemplate?: string;
    dictionary?: string;
    setAdditionalDictionary?: (v: string) => void;
    setStartTime?: (v: number | null) => void;
    setEndTime?: (v: number | null) => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info', context?: LogContext) => void;
}

// Extracted from SinoVietnameseFixerPage.tsx (step 4 refactor): all state + AI
// handler logic for the Han-Viet fixer tool. Logic kept 100% identical to original.
// NOTE: handleTranslatedFileUpload is part of the props contract (also used directly
// by the SinoVietnameseFixerPage component itself) but this hook doesn't need it,
// so it's intentionally not destructured here.
export const useSinoVietnameseFixerPage = ({
    files, setFilesSafe, addToast, state, setState,
    storyInfo, promptTemplate, dictionary, setAdditionalDictionary,
    setStartTime, setEndTime, addLog
}: UseSinoVietnameseFixerPageProps) => {
    const [isAnalyzingRules, setIsAnalyzingRules] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const imageInputRef = useRef<HTMLInputElement>(null);

    // Danh sách rule đang ở trạng thái "xem trước" (đã đếm thử số vị trí khớp,
    // gắn nhãn tin cậy). Lưu trong `state` (persisted) thay vì useState cục bộ, để
    // lựa chọn tick/untick của người dùng không bị mất khi chuyển sang tab khác rồi
    // quay lại — null nghĩa là chưa xem trước / đang ở chế độ soạn thảo.
    const previewRules: PreviewFixRule[] | null = state?.previewSinoRules ?? null;
    const setPreviewRules = (
        updater: PreviewFixRule[] | null | ((prev: PreviewFixRule[] | null) => PreviewFixRule[] | null)
    ) => {
        setState((prev: any) => {
            const prevRules: PreviewFixRule[] | null = prev?.previewSinoRules ?? null;
            const nextRules = typeof updater === 'function' ? (updater as any)(prevRules) : updater;
            return { ...(prev || {}), previewSinoRules: nextRules };
        });
    };

    const setUnfixedList = (val: string) => setState((prev: any) => ({ ...(prev || {}), unfixedList: val }));
    const setFixedList = (val: string) => {
        setState((prev: any) => ({ ...(prev || {}), fixedList: val }));
        // Danh sách rule vừa đổi (edit tay hoặc đề xuất Pro mới) -> preview cũ (nếu có)
        // không còn đại diện đúng nội dung hiện tại, phải xem trước lại từ đầu.
        setPreviewRules(null);
    };
    const setCustomRules = (val: string) => setState((prev: any) => ({ ...(prev || {}), customRules: val }));
    const setRuleImages = (val: string[]) => setState((prev: any) => ({ ...(prev || {}), sinoRuleImages: val }));

    const unfixedList = state?.unfixedList || '';
    const fixedList = state?.fixedList || '';
    const customRules = state?.customRules || '';
    const ruleImages: string[] = state?.sinoRuleImages || [];

    const CHUNK_SIZE = ANALYSIS_CHUNK_MAX_CHARS;

    // Cài đặt tuỳ chỉnh cho bước hậu kiểm/xem trước — persisted trong `state` (giữ khi
    // chuyển tab qua lại), y hệt cơ chế bên usePromptFixPage.ts (tab Sửa Lỗi).
    const DEFAULT_RULE_FIX_SETTINGS = {
        postCheckBatchSize: 300, previewSearchThreshold: 40, postCheckParallelism: 2,
        // Ngưỡng cảnh báo "thông tin sơ sài" khi Import (đề xuất cải thiện tồn đọng - trước đây
        // cố định cứng trong storyInfoHelpers.ts, nay tuỳ chỉnh được qua Cài đặt).
        sparseContextMinLength: 30, sparseDictMinEntries: 3, sparsePromptMinLength: 200,
    };
    const ruleFixSettings = { ...DEFAULT_RULE_FIX_SETTINGS, ...(state?.ruleFixSettings || {}) };
    const setRuleFixSettings = (partial: Partial<typeof DEFAULT_RULE_FIX_SETTINGS>) => {
        setState((prev: any) => ({
            ...(prev || {}),
            ruleFixSettings: { ...DEFAULT_RULE_FIX_SETTINGS, ...(prev?.ruleFixSettings || {}), ...partial },
        }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles || uploadedFiles.length === 0) return;
        const newImages = [...ruleImages];
        Array.from(uploadedFiles).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                newImages.push(reader.result as string);
                setRuleImages([...newImages]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        const updated = [...ruleImages];
        updated.splice(index, 1);
        setRuleImages(updated);
    };

    const handleAnalyzeRules = async () => {
        if (!customRules.trim() && ruleImages.length === 0) {
            addToast('Vui lòng nhập quy tắc hoặc tải ảnh minh họa lỗi!', 'error');
            return;
        }
        setIsAnalyzingRules(true);
        try {
            const ai = getAiClient();
            const contentParts: any[] = [];
            if (ruleImages.length > 0) {
                ruleImages.forEach(img => {
                    const mimeType = img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
                    contentParts.push({ inlineData: { data: img.split(',')[1], mimeType } });
                });
            }
            const storyContextBlock = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);
            contentParts.push({
                text: `Bạn là chuyên gia biên tập bản dịch truyện tiếng Việt.
${storyContextBlock ? `${storyContextBlock}\n` : ''}${customRules.trim() ? `Yêu cầu/quy tắc người dùng nhập:\n${customRules.trim()}\n\n` : ''}${ruleImages.length > 0 ? 'Dựa trên ảnh lỗi đính kèm và ' : 'Dựa trên '}yêu cầu trên (kết hợp thông tin bộ truyện ở trên nếu có), hãy phân tích và đề xuất bộ quy tắc tìm kiếm và quét lỗi cụ thể, rõ ràng, có thể áp dụng ngay.

QUAN TRỌNG: Đây chỉ là bước mô tả HƯỚNG QUÉT, không phải danh sách lỗi thật — không tự chèn ví dụ thuộc thể loại khác với truyện đang xử lý (vd: đừng nêu ví dụ thuật ngữ tu tiên nếu truyện không phải tiên hiệp/huyền huyễn).

Trả về dạng văn bản quy tắc gọn gàng, mỗi dòng 1 quy tắc, ví dụ:
- Tìm và sửa lỗi xưng hô "Ta" thành "Ngươi" bị lẫn lộn trong đối thoại
- Tìm các cụm Hán Việt đảo ngược như "trung niên nam tử" → "nam tử trung niên"
- v.v.

CHỈ TRẢ VỀ CÁC DÒNG QUY TẮC, KHÔNG GIẢI THÍCH DÀI DÒNG.`
            });

            const res = await smartExecution(
                ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: contentParts,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.2, maxOutputTokens: 4096 }
                    });
                    return r.text || '';
                },
                'Phân tích quy tắc Hán Việt',
                (msg, context) => addLog?.(msg, 'info', context)
            );
            if (res.trim()) {
                setCustomRules(res.trim());
                addToast('Đã phân tích và cập nhật quy tắc! Bạn có thể chỉnh sửa trước khi quét.', 'success');
            }
        } catch (e: any) {
            addToast(`Lỗi phân tích quy tắc: ${e.message}`, 'error');
        } finally {
            setIsAnalyzingRules(false);
        }
    };

    const handleScan = async () => {
        setIsScanning(true);
        setFixedList('');
        setStartTime?.(Date.now());
        setEndTime?.(null);
        addLog?.('Bắt đầu quét Hán Việt...', 'info');

        try {
            const scanFiles = files.filter(f => f.translatedContent);

            if (scanFiles.length === 0) {
                addToast('Không có nội dung bản dịch nào để quét.', 'error');
                setIsScanning(false);
                return;
            }

            // FIX (fix55): trước đây chỉ "né" cắt giữa dòng/giữa từ (tìm \n hoặc dấu cách gần
            // nhất), nhưng vẫn có thể cắt ngang thân 1 chương giữa 2 batch. Giờ gộp theo ranh
            // giới file/chương — chỉ bất đắc dĩ cắt trong nội bộ 1 chương nếu bản thân nó đã vượt
            // quá CHUNK_SIZE.
            const chunks: string[] = chunkTextByFileBoundary(
                scanFiles.map(f => ({ text: f.translatedContent as string })),
                CHUNK_SIZE
            );

            const batches: string[][] = [];
            for (let j = 0; j < chunks.length; j += 2) batches.push(chunks.slice(j, j + 2));

            setScanProgress({ current: 0, total: batches.length });
            let combinedList = '';
            addLog?.(`Chia thành ${chunks.length} phần, ${batches.length} batch song song.`, 'info');
            const storyContextBlock = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);

            for (let b = 0; b < batches.length; b++) {
                addLog?.(`Đang quét Batch ${b + 1}/${batches.length}...`, 'info');
                const customRulesPrompt = customRules ? `\nQuy tắc bổ sung:\n${customRules}\n` : '';

                const batchPromises = batches[b].map(async (chunk, idx) => {
                    const prompt = `${storyContextBlock ? `${storyContextBlock}\n` : ''}Tìm và liệt kê các lỗi Hán Việt, cụm Hán Việt khó hiểu, lỗi đảo ngược từ, từ ngữ sai ngữ cảnh, và lỗi chèn ngoại ngữ (kết hợp thông tin bộ truyện ở trên nếu có để xác định đúng thuật ngữ đặc thù không phải lỗi).
KHÔNG bắt lỗi thuật ngữ/cảnh giới/pháp bảo tiên hiệp đặc thù ĐÚNG thể loại của truyện này.${customRulesPrompt}
Định dạng kết quả: "- [từ_lỗi] → [gợi_ý_sửa]" hoặc "- [từ_lỗi]". KHÔNG giải thích.

Văn bản:\n${chunk}`;
                    try {
                        return await smartExecution(
                            ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                            async (modelId) => {
                                const ai = getAiClient();
                                const r = await ai.models.generateContent({
                                    model: modelId, contents: prompt,
                                    config: { safetySettings: SAFETY_SETTINGS }
                                });
                                return r.text || '';
                            },
                            `Quét Hán Việt batch ${b + 1} phần ${idx + 1}`,
                            (msg, context) => addLog?.(msg, 'info', context)
                        );
                    } catch (e: any) {
                        addLog?.(`Lỗi quét batch ${b + 1} phần ${idx + 1}: ${e.message}`, 'error');
                        return '';
                    }
                });

                const results = await Promise.all(batchPromises);
                combinedList += results.filter(Boolean).join('\n') + '\n';
                setScanProgress({ current: b + 1, total: batches.length });
                await new Promise(r => setTimeout(r, 800));
            }

            const rawLines = [unfixedList, combinedList].join('\n').split('\n').map(l => l.trim()).filter(Boolean);
            const dedupMap = new Map<string, string>();
            rawLines.forEach(line => {
                const clean = line.replace(/^[-*•\d.]*\s*/, '').trim();
                if (clean && !clean.toLowerCase().includes('không tìm thấy')) {
                    const key = clean.toLowerCase().replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '');
                    if (!dedupMap.has(key)) dedupMap.set(key, clean);
                }
            });
            const deduped = Array.from(dedupMap.values()).map(e => `- ${e}`).join('\n');
            setUnfixedList(deduped || 'Không tìm thấy lỗi nào.');
            addToast('Quét xong!', 'success');
            addLog?.('Quét Hán Việt hoàn tất!', 'success');
        } catch (error: any) {
            addToast(`Lỗi quét: ${error.message}`, 'error');
        } finally {
            setIsScanning(false);
            setEndTime?.(Date.now());
        }
    };

    const handleFix = async () => {
        if (!unfixedList) return;
        setIsFixing(true);
        setStartTime?.(Date.now());
        setEndTime?.(null);

        const lines = unfixedList.split('\n').map(l => l.trim());
        const dedupMap = new Map<string, string>();
        for (const line of lines) {
            const clean = line.replace(/^[-*•\d.]*\s*/, '').trim();
            if (clean && !clean.toLowerCase().includes('không tìm thấy')) {
                const key = clean.toLowerCase().replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '');
                if (!dedupMap.has(key)) dedupMap.set(key, clean);
            }
        }
        const errorArray = Array.from(dedupMap.values());
        setUnfixedList(errorArray.map(e => `- ${e}`).join('\n'));

        if (errorArray.length === 0) {
            addToast('Danh sách lỗi trống.', 'info');
            setIsFixing(false);
            return;
        }

        const CHUNK_ITEMS = 500;
        const errorChunks: string[][] = [];
        for (let i = 0; i < errorArray.length; i += CHUNK_ITEMS) errorChunks.push(errorArray.slice(i, i + CHUNK_ITEMS));

        const contextInfo = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);
        const customRulesPrompt = customRules ? `\nYêu cầu bổ sung:\n${customRules}\n` : '';

        try {
            addLog?.(`Bắt đầu Đề xuất Pro - ${errorChunks.length} phần, song song 2 luồng...`, 'info');
            let finalOut = '';

            // Process in parallel batches of 2
            for (let i = 0; i < errorChunks.length; i += 2) {
                const batchChunks = errorChunks.slice(i, i + 2);
                const batchPromises = batchChunks.map(async (chunk, bIdx) => {
                    const chunkList = chunk.map(e => `- ${e}`).join('\n');
                    const prompt = `Phân tích danh sách cụm từ nghi ngờ lỗi Hán Việt sau (đây là NGUỒN DỮ LIỆU DUY NHẤT được phép dùng để tạo quy tắc). Xác định cái nào thực sự cần sửa, gộp các biến thể trùng lặp.

⚠️ NGHIÊM CẤM SUY DIỄN: Chỉ được đề xuất sửa cho các mục ĐÃ CÓ trong danh sách bên dưới. TUYỆT ĐỐI KHÔNG tự thêm các cụm/từ khác không có trong danh sách, dù ${contextInfo ? 'thông tin bộ truyện/quy tắc bổ sung' : 'yêu cầu bổ sung'} có nêu ví dụ mang tính khái quát.
⚠️ KHÔNG ÁP ĐẶT THỂ LOẠI: TUYỆT ĐỐI KHÔNG tự chèn/sửa thành thuật ngữ tu tiên/huyền huyễn (linh thạch, linh khí, tu vi...) trừ khi truyện thực sự thuộc thể loại đó (xem [THÔNG TIN BỘ TRUYỆN] bên dưới nếu có) và cụm đó có mặt trong danh sách.

BẢO TỒN: Tên riêng, địa danh, chiêu thức, thành ngữ Hán Việt quen thuộc, và thuật ngữ đặc thù ĐÚNG thể loại của truyện này.
${contextInfo}${customRulesPrompt}

YÊU CẦU ĐỊNH DẠNG (MÁY ĐỌC - NGHIÊM NGẶT):
Chỉ trả về danh sách quy tắc dạng: cụm lỗi -> cụm đã sửa. Mỗi quy tắc nằm trên một dòng riêng biệt. Không chứa dấu gạch đầu dòng, không ghi số thứ tự, và TUYỆT ĐỐI KHÔNG GIẢI THÍCH LÝ DO hay ghi thêm thông tin thừa nào khác. Nếu một mục trong danh sách không thực sự là lỗi, bỏ qua mục đó (không xuất dòng nào cho nó) thay vì cố gán một sửa đổi không cần thiết.

Danh sách (Phần ${i + bIdx + 1}/${errorChunks.length}):\n${chunkList}`;

                    return await smartExecution(
                        ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                        async (modelId) => {
                            const ai = getAiClient();
                            const r = await ai.models.generateContent({
                                model: modelId, contents: prompt,
                                config: { safetySettings: SAFETY_SETTINGS }
                            });
                            return r.text || '';
                        },
                        `Đề xuất Pro Hán Việt phần ${i + bIdx + 1}`,
                        (msg, context) => addLog?.(msg, 'info', context)
                    );
                });

                const results = await Promise.all(batchPromises);
                finalOut += results.filter(Boolean).join('\n\n') + '\n\n';
                if (i + 2 < errorChunks.length) await new Promise(r => setTimeout(r, 800));
            }

            // Deduplicate output
            const mergedLines = finalOut.split('\n').filter(l => l.trim());
            const dedupFixes = new Map<string, string>();
            mergedLines.forEach(line => {
                const trimmed = line.trim();
                const cleanedLine = trimmed.replace(/^[-*\s\d.]+\s*/, '');
                if (!cleanedLine) return;

                let delimiter = '';
                let index = -1;
                const delimiters = ['->', '→', '=>', '='];
                for (const delim of delimiters) {
                    const idx = cleanedLine.indexOf(delim);
                    if (idx !== -1) {
                        delimiter = delim;
                        index = idx;
                        break;
                    }
                }

                if (index !== -1) {
                    let wrong = cleanedLine.slice(0, index).trim();
                    let right = cleanedLine.slice(index + delimiter.length).trim();
                    right = right.replace(/\s*[\(\[].*$/, '').trim();

                    wrong = wrong.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();
                    right = right.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();

                    if (wrong && wrong !== right) {
                        const key = wrong.toLowerCase();
                        if (!dedupFixes.has(key)) {
                            dedupFixes.set(key, `${wrong} -> ${right}`);
                        }
                    }
                } else if (trimmed.length > 2 && !trimmed.includes('```') && !trimmed.includes('---')) {
                    dedupFixes.set(trimmed.toLowerCase(), trimmed);
                }
            });

            let verifiedFixed = Array.from(dedupFixes.values()).join('\n');

            // Hậu kiểm nhẹ (Flash), chia theo lô: loại các quy tắc Pro lỡ suy diễn không có
            // mặt trong danh sách lỗi thô (unfixedList) — không sửa nội dung, chỉ lọc bớt.
            // Rule list được chia lô (mặc định 300 dòng/lô) để tránh vượt giới hạn token đầu
            // vào khi truyện dài có hàng nghìn rule. Lỗi ở bước này không chặn luồng chính,
            // chỉ giữ nguyên lô gốc nếu lô đó thất bại/bất thường.
            try {
                const ruleChunks = chunkRuleLines(verifiedFixed, ruleFixSettings.postCheckBatchSize);
                if (ruleChunks.length > 0) {
                    const parallelism = Math.max(1, Math.min(3, ruleFixSettings.postCheckParallelism));
                    addLog?.(`Đang hậu kiểm (Flash) để loại quy tắc không có căn cứ trong lỗi thô${ruleChunks.length > 1 ? ` (${ruleChunks.length} lô, chạy song song ${parallelism} lô/lượt)` : ''}...`, 'info');

                    // Mảng theo INDEX (không push) để giữ đúng thứ tự lô gốc dù các lô trong
                    // cùng 1 nhóm chạy song song có thể hoàn tất không theo thứ tự.
                    const postCheckedChunks: string[] = new Array(ruleChunks.length);
                    let totalBefore = 0;
                    let totalAfter = 0;
                    let anyAbnormal = false;

                    for (let g = 0; g < ruleChunks.length; g += parallelism) {
                        const groupIndices: number[] = [];
                        for (let k = g; k < Math.min(g + parallelism, ruleChunks.length); k++) groupIndices.push(k);

                        if (ruleChunks.length > 1) {
                            addLog?.(`Hậu kiểm lô ${groupIndices.map(k => k + 1).join(', ')}/${ruleChunks.length}...`, 'info');
                        }

                        await Promise.all(groupIndices.map(async (c) => {
                            const chunk = ruleChunks[c];
                            const beforeCount = chunk.split('\n').filter(l => l.trim()).length;
                            totalBefore += beforeCount;

                            try {
                                const postCheckRes = await smartExecution(
                                    ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                                    async (modelId) => {
                                        const ai = getAiClient();
                                        const r = await ai.models.generateContent({
                                            model: modelId,
                                            contents: `Bạn là bước HẬU KIỂM, nhiệm vụ DUY NHẤT là loại bỏ quy tắc không có căn cứ — KHÔNG được sửa nội dung, KHÔNG thêm dòng mới.

[DANH SÁCH LỖI THÔ GỐC — CĂN CỨ DUY NHẤT ĐƯỢC CHẤP NHẬN]
${unfixedList}

[QUY TẮC ĐỀ XUẤT — CẦN KIỂM TRA TỪNG DÒNG]
${chunk}

[NHIỆM VỤ]
Với MỖI dòng trong [QUY TẮC ĐỀ XUẤT] (định dạng "cụm sai -> cụm đúng"), kiểm tra xem cụm bên trái (vế sai) có THỰC SỰ xuất hiện (dạng chuỗi con, không cần khớp tuyệt đối 100%) ở ít nhất 1 dòng trong [DANH SÁCH LỖI THÔ GỐC] hay không.
- Nếu CÓ căn cứ: giữ nguyên dòng đó y hệt, không sửa chữ nào.
- Nếu KHÔNG tìm thấy căn cứ nào: loại bỏ hẳn dòng đó, không xuất ra.

CHỈ TRẢ VỀ các dòng quy tắc còn hợp lệ, giữ nguyên định dạng gốc, KHÔNG giải thích, KHÔNG đánh số, KHÔNG thêm lời dẫn.`,
                                            config: { safetySettings: SAFETY_SETTINGS, temperature: 0 }
                                        });
                                        return r.text || '';
                                    },
                                    `Hậu kiểm Flash Hán Việt${ruleChunks.length > 1 ? ` lô ${c + 1}/${ruleChunks.length}` : ''}`,
                                    (msg, context) => addLog?.(msg, 'info', context)
                                );

                                const cleanedChunk = postCheckRes.trim();
                                const afterCount = cleanedChunk ? cleanedChunk.split('\n').filter(l => l.trim()).length : 0;

                                if (cleanedChunk && afterCount <= beforeCount) {
                                    postCheckedChunks[c] = cleanedChunk;
                                    totalAfter += afterCount;
                                } else {
                                    if (cleanedChunk) anyAbnormal = true;
                                    postCheckedChunks[c] = chunk;
                                    totalAfter += beforeCount;
                                }
                            } catch (chunkErr: any) {
                                addLog?.(`Hậu kiểm lô ${c + 1}/${ruleChunks.length} thất bại (giữ nguyên lô này): ${chunkErr.message}`, 'error');
                                postCheckedChunks[c] = chunk;
                                totalAfter += beforeCount;
                            }
                        }));

                        if (g + parallelism < ruleChunks.length) await new Promise(r2 => setTimeout(r2, 400));
                    }

                    verifiedFixed = postCheckedChunks.join('\n');

                    if (totalAfter < totalBefore) {
                        const msg = `Hậu kiểm: loại bỏ ${totalBefore - totalAfter} quy tắc không có căn cứ trong lỗi thô (còn lại ${totalAfter}/${totalBefore}).`;
                        addToast(msg, 'info');
                        addLog?.(msg, 'success');
                    } else if (anyAbnormal) {
                        addLog?.('Một số lô hậu kiểm trả về bất thường (nhiều dòng hơn bản gốc) — đã giữ nguyên các lô đó.', 'error');
                    } else {
                        addLog?.('Hậu kiểm: tất cả quy tắc đều có căn cứ trong lỗi thô.', 'success');
                    }
                }
            } catch (e: any) {
                addLog?.(`Hậu kiểm thất bại (bỏ qua, giữ nguyên đề xuất gốc): ${e.message}`, 'error');
            }

            setFixedList(verifiedFixed);
            addToast('Đề xuất chỉnh sửa xong!', 'success');
            addLog?.(`Hoàn tất Đề xuất Pro - ${errorChunks.length} phần!`, 'success');
        } catch (e: any) {
            addToast(`Lỗi đề xuất sửa: ${e.message}`, 'error');
        } finally {
            setIsFixing(false);
            setEndTime?.(Date.now());
        }
    };

    // Bật/tắt 1 rule cụ thể trong bảng xem trước (không đụng tới các rule khác).
    const togglePreviewRule = (id: string) => {
        setPreviewRules(prev => prev ? prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)) : prev);
    };

    // Bật/tắt TẤT CẢ rule trong bảng xem trước cùng lúc (tích chọn hết / bỏ chọn hết).
    const setAllPreviewRulesEnabled = (enabled: boolean) => {
        setPreviewRules(prev => prev ? prev.map(r => ({ ...r, enabled })) : prev);
    };

    // Huỷ xem trước, quay lại chế độ soạn thảo quy tắc (không đụng gì tới file).
    const cancelPreview = () => setPreviewRules(null);

    /**
     * Chạy theo 2 pha, giữ chung 1 hàm/1 nút bấm cho gọn UI (xem chi tiết giải
     * thích trong applyFixesToTranslation của usePromptFixPage.ts — logic song sinh):
     *  - Pha 1 (chưa có previewRules): parse rulesText, đếm thử số vị trí sẽ khớp
     *    trong dữ liệu thật (dry-run — KHÔNG ghi đè gì), gắn nhãn tin cậy theo tần
     *    suất xuất hiện trong unfixedList (lỗi thô), hiển thị bảng cho người dùng soát.
     *  - Pha 2 (đã có previewRules): chỉ áp dụng thật những rule "enabled = true".
     */
    const applyFixesToFiles = async (rulesText: string) => {
        // ----- PHA 1: XEM TRƯỚC -----
        if (!previewRules) {
            if (!rulesText.trim()) {
                addToast('Không có quy tắc để áp dụng.', 'error');
                return;
            }

            setIsPreviewing(true);
            addLog?.('Đang phân tích quy tắc để xem trước (chưa áp dụng gì)...', 'info');
            await new Promise(resolve => setTimeout(resolve, 30));

            try {
                const preview = buildRulePreview(rulesText, unfixedList, files);

                if (preview.length === 0) {
                    addToast('Không tìm thấy quy tắc hợp lệ (cấu trúc Sai -> Đúng hoặc Sai = Đúng).', 'error');
                    return;
                }

                setPreviewRules(preview);

                const highCount = preview.filter(r => r.confidence === 'high').length;
                const lowCount = preview.length - highCount;
                const zeroMatchCount = preview.filter(r => r.matchCount === 0).length;
                const msg = `Xem trước ${preview.length} quy tắc: ${highCount} tin cậy cao (tự chọn sẵn), ${lowCount} chỉ xuất hiện 1 lần trong lỗi thô (cần bạn xem lại), ${zeroMatchCount} không khớp vị trí nào trong bản dịch hiện tại. Soát lại rồi nhấn "Xác nhận áp dụng".`;
                addToast(msg, 'info');
                addLog?.(msg, 'info');
            } catch (e: any) {
                addToast(`Lỗi khi xem trước: ${e.message}`, 'error');
            } finally {
                setIsPreviewing(false);
            }
            return;
        }

        // ----- PHA 2: XÁC NHẬN ÁP DỤNG -----
        const activeRules = previewRules.filter(r => r.enabled).map(({ wrong, right }) => ({ wrong, right }));

        if (activeRules.length === 0) {
            addToast('Chưa có quy tắc nào được chọn để áp dụng. Bật lại ít nhất 1 quy tắc trong bảng xem trước.', 'error');
            return;
        }

        setIsFixing(true);
        const skippedCount = previewRules.length - activeRules.length;
        addLog?.(`Đang áp dụng ${activeRules.length}/${previewRules.length} quy tắc đã xác nhận${skippedCount > 0 ? ` (bỏ qua ${skippedCount} quy tắc không được chọn)` : ''}...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const { newFiles, totalOccurrences, filesAffected } = await applyRulesToFiles(files, activeRules, {
                onProgress: (msg) => addLog?.(msg, 'info'),
            });

            // FIX: trước đây luôn báo "success" kể cả khi totalOccurrences = 0 (quy tắc hợp lệ
            // nhưng không khớp được vị trí nào trong bản dịch, thường do lệch chuẩn hóa Unicode
            // hoặc câu chữ AI đề xuất không khớp verbatim với bản dịch thật) — khiến người dùng
            // tưởng đã áp dụng xong nhưng vào biên tập/tải về vẫn y hệt bản cũ. Chỉ gọi
            // setFilesSafe khi thực sự có thay đổi, và báo rõ ràng khi 0 vị trí khớp.
            if (totalOccurrences > 0) {
                setFilesSafe(newFiles);
                const msg = `Đã áp dụng ${activeRules.length} quy tắc, thay thế ${totalOccurrences} vị trí trong ${filesAffected} file!`;
                addToast(msg, 'success');
                addLog?.(msg, 'success');
            } else {
                const msg = `Đã xử lý ${activeRules.length} quy tắc nhưng KHÔNG khớp được vị trí nào trong bản dịch — chưa có gì được thay đổi. Có thể câu chữ AI đề xuất không khớp verbatim với bản dịch thật. Hãy thử sửa quy tắc cho khớp chính xác hơn.`;
                addToast(msg, 'error');
                addLog?.(msg, 'error');
            }

            // Áp xong (dù khớp hay không) thì đóng bảng xem trước, quay lại trạng thái soạn thảo.
            setPreviewRules(null);
        } catch (e: any) {
            addToast(`Lỗi sửa dịch: ${e.message}`, 'error');
            addLog?.(`Lỗi sửa: ${e.message}`, 'error');
        } finally {
            setIsFixing(false);
        }
    };

    const handleSaveToDictionary = () => {
        if (!fixedList || !setAdditionalDictionary) return;
        let newDict = dictionary || '';
        let addCount = 0;
        fixedList.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const cleanedLine = trimmed.replace(/^[-*\s\d.]+\s*/, '');
            if (!cleanedLine) return;

            let delimiter = '';
            let index = -1;
            const delimiters = ['->', '→', '=>', '='];
            for (const delim of delimiters) {
                const idx = cleanedLine.indexOf(delim);
                if (idx !== -1) {
                    delimiter = delim;
                    index = idx;
                    break;
                }
            }

            if (index !== -1) {
                let wrong = cleanedLine.slice(0, index).trim();
                let right = cleanedLine.slice(index + delimiter.length).trim();
                right = right.replace(/\s*[\(\[].*$/, '').trim();

                wrong = wrong.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();
                right = right.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();

                if (wrong && right) {
                    const ruleStr = `${wrong}=${right}`;
                    if (!newDict.includes(ruleStr)) {
                        newDict += (newDict ? '\n' : '') + ruleStr;
                        addCount++;
                    }
                }
            }
        });
        if (addCount > 0 && setAdditionalDictionary) {
            setAdditionalDictionary(newDict);
            addToast(`Đã lưu thêm ${addCount} từ vào Từ Điển.`, 'success');
        } else {
            addToast('Các từ này đã có sẵn trong Từ Điển.', 'info');
        }
    };

    const handleCopy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); addToast('Đã copy!', 'success'); }
        catch { addToast('Copy thất bại', 'error'); }
    };

    const handleUploadTxt = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) { setter(ev.target.result as string); addToast('Đã tải dữ liệu!', 'success'); } };
        reader.readAsText(file);
        e.target.value = '';
    };


    return {
        isAnalyzingRules, isScanning, isFixing, isPreviewing, scanProgress,
        imageInputRef,
        setUnfixedList, setFixedList, setCustomRules,
        unfixedList, fixedList, customRules, ruleImages,
        previewRules, togglePreviewRule, cancelPreview, setAllPreviewRulesEnabled,
        ruleFixSettings, setRuleFixSettings,
        handleImageUpload, removeImage,
        handleAnalyzeRules, handleScan, handleFix, applyFixesToFiles,
        handleSaveToDictionary, handleCopy, handleUploadTxt,
    };
};
