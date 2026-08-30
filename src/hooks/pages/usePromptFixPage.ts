import { useState, useRef } from 'react';
import { FileItem, LogContext } from '../../types';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../../services/api/gemini';
import { cleanRepetitiveContent } from '../../utils/text/optimization';
import { buildRulePreview, applyRulesToFiles, chunkRuleLines, PreviewFixRule } from '../../utils/text/ruleFixing';
import { chunkTextByFileBoundary } from '../../utils/fileHelpers';
import { buildStoryContextBlock } from '../../prompts';
import { ANALYSIS_CHUNK_MAX_CHARS } from '../../constants';

export interface UsePromptFixPageProps {
    files: FileItem[];
    setFilesSafe: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
    handleTranslatedFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSyncSupportInfo?: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    handleExportSupportInfo?: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    state: any;
    setState: any;
    storyInfo?: any;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info', context?: LogContext) => void;
    promptTemplate?: string;
    dictionary?: string;
}

// Extracted from PromptFixPage.tsx (step 4 refactor): all state + AI handler logic
// for the prompt-error-fix tool. Logic kept 100% identical to original.
// NOTE: handleTranslatedFileUpload is part of the props contract (also used directly by
// the PromptFixPage component itself) but this hook doesn't need it, so it's intentionally
// not destructured here. promptTemplate/dictionary ARE destructured (dùng để chèn thông tin
// bộ truyện — thể loại/tính cách/bối cảnh/lưu phái/tóm tắt/ngữ cảnh/quy tắc bổ sung + từ điển
// + prompt dịch đang dùng — vào các prompt phân tích/quét/đề xuất bên dưới qua buildStoryContextBlock).
export const usePromptFixPage = ({
    files, setFilesSafe, addToast, state, setState, storyInfo, addLog, promptTemplate, dictionary
}: UsePromptFixPageProps) => {
    const [isAnalyzingReq, setIsAnalyzingReq] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isProposing, setIsProposing] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Danh sách rule đang ở trạng thái "xem trước" (đã đếm thử số vị trí khớp,
    // gắn nhãn tin cậy). Lưu trong `state` (persisted) thay vì useState cục bộ, để
    // lựa chọn tick/untick của người dùng không bị mất khi chuyển sang tab khác rồi
    // quay lại — null nghĩa là chưa xem trước / đang ở chế độ soạn thảo.
    const previewRules: PreviewFixRule[] | null = state?.previewFixRules ?? null;
    const setPreviewRules = (
        updater: PreviewFixRule[] | null | ((prev: PreviewFixRule[] | null) => PreviewFixRule[] | null)
    ) => {
        setState((prev: any) => {
            const prevRules: PreviewFixRule[] | null = prev?.previewFixRules ?? null;
            const nextRules = typeof updater === 'function' ? (updater as any)(prevRules) : updater;
            return { ...(prev || {}), previewFixRules: nextRules };
        });
    };

    const setRawErrors = (val: string) => setState((prev: any) => ({ ...(prev || {}), rawErrors: val }));
    const setProcessedFixes = (val: string) => {
        setState((prev: any) => ({ ...(prev || {}), processedFixes: val }));
        // Rule text vừa đổi (edit tay hoặc đề xuất Pro mới) -> preview cũ (nếu có) không còn
        // đại diện đúng cho nội dung hiện tại nữa, phải xem trước lại từ đầu.
        setPreviewRules(null);
    };
    const setPrompt = (val: string) => setState((prev: any) => ({ ...(prev || {}), prompt: val }));
    const setImages = (val: string[]) => setState((prev: any) => ({ ...(prev || {}), fixImages: val }));

    const rawErrors = state?.rawErrors || '';
    const processedFixes = state?.processedFixes || '';
    const fixPrompt = state?.prompt || '';
    const fixImages: string[] = state?.fixImages || [];

    // Cài đặt tuỳ chỉnh cho bước hậu kiểm/xem trước — persisted trong `state` (giữ khi
    // chuyển tab qua lại), có giá trị mặc định hợp lý nếu người dùng chưa từng chỉnh.
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

    const CHUNK_SIZE = ANALYSIS_CHUNK_MAX_CHARS;

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles || uploadedFiles.length === 0) return;
        const newImages = [...fixImages];
        Array.from(uploadedFiles).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => { newImages.push(reader.result as string); setImages([...newImages]); };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const handleUploadTxt = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) { setter(ev.target.result as string); addToast('Đã tải dữ liệu!', 'success'); } };
        reader.readAsText(file);
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        const updated = [...fixImages];
        updated.splice(index, 1);
        setImages(updated);
    };

    // Analyze user requirements with Flash model, output refined scan rules
    const handleAnalyzeRequirements = async () => {
        if (!fixPrompt.trim() && fixImages.length === 0) {
            addToast('Vui lòng nhập yêu cầu hoặc tải ảnh lỗi minh họa!', 'error');
            return;
        }
        setIsAnalyzingReq(true);
        try {
            const ai = getAiClient();
            const parts: any[] = [];
            fixImages.forEach(img => {
                const mimeType = img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
                parts.push({ inlineData: { data: img.split(',')[1], mimeType } });
            });
            const storyContextBlock = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);
            parts.push({
                text: `Bạn là chuyên gia biên tập bản dịch truyện tiếng Việt.
${storyContextBlock ? `${storyContextBlock}\n` : ''}${fixPrompt.trim() ? `Yêu cầu người dùng:\n${fixPrompt.trim()}\n\n` : ''}${fixImages.length > 0 ? 'Dựa trên ảnh lỗi đính kèm và ' : 'Dựa trên '}yêu cầu trên (kết hợp thông tin bộ truyện ở trên nếu có), hãy đề xuất bộ quy tắc tìm kiếm lỗi cụ thể và hướng xử lý rõ ràng.

QUAN TRỌNG: Đây chỉ là bước mô tả HƯỚNG QUÉT, KHÔNG PHẢI danh sách lỗi thật. Không tự bịa thêm ví dụ thuộc thể loại khác với truyện đang xử lý (vd: đừng nêu ví dụ "linh thạch", "linh khí", "tu vi" nếu truyện không phải tiên hiệp/huyền huyễn tu chân) — mọi ví dụ minh hoạ đưa ra chỉ để làm rõ DẠNG lỗi (sai chính tả, sai tên riêng, ký tự rác thay chữ...), không nhằm mục đích liệt kê sẵn từ để Pro sau này áp dụng máy móc.

Ví dụ đầu ra (chỉ minh hoạ CẤU TRÚC, không phải nội dung cụ thể của truyện):
- Tìm các đoạn lỗi xưng hô "Ta" bị đổi thành "Ngươi" trong lời thoại nhân vật chính
- Tìm tên nhân vật chính bị sai chính tả/biến thể không nhất quán giữa các chương
- Tìm ký tự số/ký tự lạ chèn thay cho một chữ do lỗi font khi thu thập raw (chỉ nêu nếu người dùng có mô tả/ảnh minh hoạ cụ thể hiện tượng này)

CHỈ TRẢ VỀ CÁC DÒNG QUY TẮC GỌN GÀNG, KHÔNG GIẢI THÍCH DÀI DÒNG.`
            });

            const res = await smartExecution(
                ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: parts,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.2, maxOutputTokens: 4096 }
                    });
                    return r.text || '';
                },
                'Phân tích yêu cầu sửa lỗi',
                (msg, context) => addLog?.(msg, 'info', context)
            );

            if (res.trim()) {
                setPrompt(res.trim());
                addToast('Đã phân tích và cập nhật yêu cầu! Bạn có thể chỉnh sửa trước khi quét.', 'success');
            }
        } catch (e: any) {
            addToast(`Lỗi phân tích: ${e.message}`, 'error');
        } finally {
            setIsAnalyzingReq(false);
        }
    };

    const handleScan = async () => {
        if (!fixPrompt.trim() && fixImages.length === 0) {
            addToast('Vui lòng nhập yêu cầu sửa lỗi hoặc tải ảnh minh họa!', 'error');
            return;
        }

        setIsScanning(true);
        setProcessedFixes('');
        addLog?.('Bắt đầu quét lỗi...', 'info');

        try {
            const scanFiles = files.filter(f => f.translatedContent || f.content);

            if (scanFiles.length === 0) {
                addToast('Không có văn bản để quét. Hãy tải file trước.', 'error');
                return;
            }

            // FIX (fix55): trước đây nối hết chương thành 1 chuỗi rồi cắt cứng theo ký tự, có thể
            // cắt ngang thân 1 chương giữa 2 batch quét lỗi. Giờ gộp theo ranh giới file/chương.
            const chunks: string[] = chunkTextByFileBoundary(
                scanFiles.map(f => ({ text: f.translatedContent || f.content })),
                CHUNK_SIZE
            );

            setScanProgress({ current: 0, total: chunks.length });

            const baseImageParts: any[] = fixImages.map(img => ({
                inlineData: {
                    data: img.split(',')[1],
                    mimeType: img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg'
                }
            }));

            let collectedRaw = rawErrors ? rawErrors + '\n' : '';
            setRawErrors(collectedRaw);
            const ai = getAiClient();
            const storyContextBlock = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);

            for (let i = 0; i < chunks.length; i += 2) {
                const batch = chunks.slice(i, i + 2);
                const promises = batch.map(chunk => {
                    const parts: any[] = [
                        {
                            text: `${storyContextBlock || `[Tên truyện: ${storyInfo?.title || 'Unknown'}]\n`}
[YÊU CẦU SỬA LỖI]
${fixPrompt}

[NHIỆM VỤ]
Dựa vào yêu cầu (và ảnh nếu có, và thông tin bộ truyện ở trên nếu có), quét đoạn text sau và trích xuất các đoạn bị lỗi tương tự.
Chỉ liệt kê lỗi tìm thấy, dạng gạch đầu dòng, KHÔNG giải thích.

[TEXT CẦN QUÉT]
`
                        },
                        ...baseImageParts,
                        { text: chunk }
                    ];

                    return smartExecution(
                        ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                        async (modelId) => {
                            const res = await ai.models.generateContent({
                                model: modelId,
                                contents: parts,
                                config: { safetySettings: SAFETY_SETTINGS, temperature: 0.1, maxOutputTokens: 8192 }
                            });
                            return res.text || '';
                        },
                        'Quét Lỗi Flash',
                        undefined
                    );
                });

                const results = await Promise.all(promises);
                for (const txt of results) {
                    if (txt.trim()) {
                        collectedRaw += '\n' + txt.trim();
                        setRawErrors(cleanRepetitiveContent(collectedRaw));
                    }
                }
                setScanProgress({ current: Math.min(i + 2, chunks.length), total: chunks.length });
            }

            addLog?.('Quét xong. Sẵn sàng đề xuất Pro.', 'success');
            addToast('Quét xong! Nhấn "Đề xuất Pro" để tạo quy tắc sửa.', 'success');

        } catch (e: any) {
            addToast(`Lỗi quét: ${e.message}`, 'error');
        } finally {
            setIsScanning(false);
            setScanProgress({ current: 0, total: 0 });
        }
    };

    const handlePropose = async () => {
        if (!rawErrors.trim()) {
            addToast('Chưa có lỗi thô để đề xuất. Hãy quét trước.', 'error');
            return;
        }

        const errorLines = rawErrors.split('\n').map(l => l.trim()).filter(Boolean);
        const CHUNK_ITEMS = 500;
        const errorChunks: string[][] = [];
        for (let i = 0; i < errorLines.length; i += CHUNK_ITEMS) errorChunks.push(errorLines.slice(i, i + CHUNK_ITEMS));

        setIsProposing(true);
        addLog?.(`Bắt đầu Đề xuất Pro - ${errorChunks.length} phần...`, 'info');

        try {
            const baseImageParts: any[] = fixImages.map(img => ({
                inlineData: {
                    data: img.split(',')[1],
                    mimeType: img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg'
                }
            }));

            const storyContextBlock = buildStoryContextBlock(storyInfo, dictionary, promptTemplate);

            const ai = getAiClient();
            let finalOut = '';

            // Process in parallel batches of 2
            for (let i = 0; i < errorChunks.length; i += 2) {
                const batchChunks = errorChunks.slice(i, i + 2);
                const batchPromises = batchChunks.map(async (chunk, bIdx) => {
                    const chunkText = chunk.join('\n');
                    const parts: any[] = [
                        {
                            text: `${storyContextBlock || `[Tên truyện: ${storyInfo?.title || ''}]\n`}
[YÊU CẦU GỐC — CHỈ ĐỂ HIỂU BỐI CẢNH/HƯỚNG SỬA, KHÔNG PHẢI DANH SÁCH LỖI]
${fixPrompt}

[LỖI THÔ TÌM THẤY — ĐÂY LÀ NGUỒN DỮ LIỆU DUY NHẤT ĐƯỢC PHÉP DÙNG ĐỂ TẠO QUY TẮC]
${chunkText}

[NHIỆM VỤ]
Phân tích TỪNG DÒNG trong [LỖI THÔ TÌM THẤY] ở trên, dùng [YÊU CẦU GỐC] chỉ để hiểu lỗi đó nên sửa thành gì. Đề xuất quy tắc CHỈNH SỬA TOÀN BỘ cho các lỗi ĐÃ CÓ MẶT trong [LỖI THÔ TÌM THẤY].

⚠️ NGHIÊM CẤM SUY DIỄN (QUAN TRỌNG NHẤT): TUYỆT ĐỐI KHÔNG được tự bịa thêm quy tắc cho những từ/cụm KHÔNG xuất hiện trong [LỖI THÔ TÌM THẤY], kể cả khi [YÊU CẦU GỐC] có nêu ví dụ minh hoạ mang tính khái quát (vd: yêu cầu gốc nói "lỗi số 0 thay chữ Linh, ví dụ 0 nhi → Linh nhi" thì CHỈ được sửa đúng cụm "0 nhi" nếu nó thực sự có trong lỗi thô — KHÔNG được suy rộng ra tự thêm "0 thạch → Linh thạch", "0 dược → Linh dược", "0 thú → Linh thú"... nếu những cụm đó không có trong lỗi thô). Mỗi quy tắc đề xuất phải truy ngược được về đúng 1 dòng cụ thể trong [LỖI THÔ TÌM THẤY].
⚠️ KHÔNG ÁP ĐẶT THỂ LOẠI: TUYỆT ĐỐI KHÔNG tự chèn thuật ngữ tu tiên/huyền huyễn (linh thạch, linh khí, linh dược, tu vi, đan dược...) trừ khi truyện đúng là thể loại tiên hiệp/tu chân/huyền huyễn (xem [THÔNG TIN BỘ TRUYỆN] ở trên) VÀ các thuật ngữ đó thực sự xuất hiện trong lỗi thô.

BẢO TỒN: Tên riêng, địa danh, thành ngữ Hán Việt, và thuật ngữ đặc thù ĐÚNG thể loại của truyện này (không phải thể loại khác).

YÊU CẦU ĐỊNH DẠNG (MÁY ĐỌC - NGHIÊM NGẶT):
Mỗi quy tắc trên 1 dòng theo kiểu: cụm từ / từ cần sửa -> đã chuẩn hóa
Chỉ 1 phương án đúng nhất - KHÔNG dùng "/" hoặc thêm giải thích dông dài ở vế sau. TUYỆT ĐỐI không viết bất kỳ lý giải nào khác. Nếu không có lỗi nào trong phần này thực sự khớp yêu cầu, KHÔNG xuất ra dòng nào (thà thiếu còn hơn bịa).

Ví dụ:
Lâm Phong -> Lâm Phàm
hoàn toàn 0 -> hoàn toàn không

Phần ${i + bIdx + 1}/${errorChunks.length}:`
                        },
                        ...baseImageParts
                    ];

                    return smartExecution(
                        ['gemini-3.1-pro-preview'],
                        async (modelId) => {
                            const r = await ai.models.generateContent({
                                model: modelId,
                                contents: parts,
                                config: { safetySettings: SAFETY_SETTINGS, temperature: 0.1 }
                            });
                            return r.text || '';
                        },
                        `Đề xuất Pro phần ${i + bIdx + 1}`,
                        (msg, context) => addLog?.(msg, 'info', context)
                    );
                });

                const results = await Promise.all(batchPromises);
                finalOut += results.filter(Boolean).join('\n') + '\n';
                if (i + 2 < errorChunks.length) await new Promise(r => setTimeout(r, 800));
            }

            let verifiedOut = cleanRepetitiveContent(finalOut);

            // Hậu kiểm nhẹ (Flash): dù prompt Pro ở trên đã cấm suy diễn, Pro vẫn có thể lỡ
            // bịa thêm rule không có mặt trong lỗi thô. Dùng Flash rẻ/nhanh để rà lại và loại
            // bỏ những dòng không truy ngược được về lỗi thô gốc — không sửa nội dung rule,
            // chỉ lọc bớt. Rule list được chia theo lô (mặc định 300 dòng/lô) để tránh vượt
            // giới hạn token đầu vào khi truyện dài có hàng nghìn rule. Nếu bước này lỗi ở bất
            // kỳ lô nào, giữ nguyên các dòng của lô đó (không chặn luồng chính vì đây là bước
            // "nice to have", không phải bắt buộc).
            try {
                const ruleChunks = chunkRuleLines(verifiedOut, ruleFixSettings.postCheckBatchSize);
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
                                    ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
                                    async (modelId) => {
                                        const r = await ai.models.generateContent({
                                            model: modelId,
                                            contents: [{
                                                text: `Bạn là bước HẬU KIỂM, nhiệm vụ DUY NHẤT là loại bỏ quy tắc không có căn cứ — KHÔNG được sửa nội dung, KHÔNG thêm dòng mới.

[LỖI THÔ GỐC — CĂN CỨ DUY NHẤT ĐƯỢC CHẤP NHẬN]
${rawErrors}

[QUY TẮC ĐỀ XUẤT — CẦN KIỂM TRA TỪNG DÒNG]
${chunk}

[NHIỆM VỤ]
Với MỖI dòng trong [QUY TẮC ĐỀ XUẤT] (định dạng "cụm sai -> cụm đúng"), kiểm tra xem cụm bên trái (vế sai) có THỰC SỰ xuất hiện (dạng chuỗi con, không cần khớp tuyệt đối 100% do có thể lệch khoảng trắng/dấu câu) ở ít nhất 1 dòng trong [LỖI THÔ GỐC] hay không.
- Nếu CÓ căn cứ: giữ nguyên dòng đó y hệt, không sửa chữ nào.
- Nếu KHÔNG tìm thấy căn cứ nào (dấu hiệu bước trước đã tự suy diễn/khái quát hoá quá đà): loại bỏ hẳn dòng đó, không xuất ra.

CHỈ TRẢ VỀ các dòng quy tắc còn hợp lệ, giữ nguyên định dạng gốc, KHÔNG giải thích, KHÔNG đánh số, KHÔNG thêm lời dẫn.`
                                            }],
                                            config: { safetySettings: SAFETY_SETTINGS, temperature: 0 }
                                        });
                                        return r.text || '';
                                    },
                                    `Hậu kiểm Flash${ruleChunks.length > 1 ? ` lô ${c + 1}/${ruleChunks.length}` : ''}`,
                                    (msg, context) => addLog?.(msg, 'info', context)
                                );

                                const cleanedChunk = postCheckRes.trim();
                                const afterCount = cleanedChunk ? cleanedChunk.split('\n').filter(l => l.trim()).length : 0;

                                // Chỉ chấp nhận nếu lô này thực sự LỌC BỚT (afterCount <= beforeCount).
                                // Nếu trả về nhiều dòng hơn -> bất thường, giữ nguyên lô gốc cho an toàn.
                                if (cleanedChunk && afterCount <= beforeCount) {
                                    postCheckedChunks[c] = cleanedChunk;
                                    totalAfter += afterCount;
                                } else {
                                    if (cleanedChunk) anyAbnormal = true;
                                    postCheckedChunks[c] = chunk;
                                    totalAfter += beforeCount;
                                }
                            } catch (chunkErr: any) {
                                // Lô này hậu kiểm lỗi -> giữ nguyên lô gốc, không chặn các lô còn lại.
                                addLog?.(`Hậu kiểm lô ${c + 1}/${ruleChunks.length} thất bại (giữ nguyên lô này): ${chunkErr.message}`, 'error');
                                postCheckedChunks[c] = chunk;
                                totalAfter += beforeCount;
                            }
                        }));

                        if (g + parallelism < ruleChunks.length) await new Promise(r2 => setTimeout(r2, 400));
                    }

                    verifiedOut = postCheckedChunks.join('\n');

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

            setProcessedFixes(verifiedOut);
            addToast('Đã tạo đề xuất quy tắc!', 'success');
            addLog?.('Đề xuất Pro hoàn tất.', 'success');
        } catch (e: any) {
            addToast(`Lỗi đề xuất: ${e.message}`, 'error');
        } finally {
            setIsProposing(false);
        }
    };

    // Bật/tắt 1 rule cụ thể trong bảng xem trước (không đụng tới các rule khác).
    const togglePreviewRule = (id: string) => {
        setPreviewRules(prev => prev ? prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)) : prev);
    };

    // Bật/tắt TẤT CẢ rule trong bảng xem trước cùng lúc (tick chọn hết / bỏ chọn hết).
    const setAllPreviewRulesEnabled = (enabled: boolean) => {
        setPreviewRules(prev => prev ? prev.map(r => ({ ...r, enabled })) : prev);
    };

    // Huỷ xem trước, quay lại chế độ soạn thảo quy tắc (không đụng gì tới file).
    const cancelPreview = () => setPreviewRules(null);

    /**
     * Hàm này chạy theo 2 pha, giữ chung 1 tên/1 nút bấm cho gọn UI:
     *  - Pha 1 (chưa có previewRules): parse quy tắc, đếm thử số vị trí sẽ khớp
     *    trong dữ liệu thật (dry-run — KHÔNG ghi đè gì), gắn nhãn tin cậy theo tần
     *    suất xuất hiện trong lỗi thô, hiển thị bảng xem trước cho người dùng soát.
     *  - Pha 2 (đã có previewRules): chỉ áp dụng thật những rule người dùng đã để
     *    "enabled = true" trong bảng xem trước, rồi dọn preview về trạng thái ban đầu.
     */
    const applyFixesToTranslation = async () => {
        // ----- PHA 1: XEM TRƯỚC -----
        if (!previewRules) {
            if (!processedFixes.trim()) {
                addToast('Không có quy tắc để áp dụng.', 'error');
                return;
            }

            setIsPreviewing(true);
            addLog?.('Đang phân tích quy tắc để xem trước (chưa áp dụng gì)...', 'info');
            await new Promise(resolve => setTimeout(resolve, 30));

            try {
                const preview = buildRulePreview(processedFixes, rawErrors, files);

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

            // FIX (fix10): trước đây luôn báo "success" kể cả khi totalOccurrences = 0 (quy tắc
            // hợp lệ nhưng không khớp được vị trí nào, thường do lệch chuẩn hóa Unicode hoặc câu
            // chữ AI đề xuất không khớp verbatim) — khiến người dùng tưởng đã áp dụng xong nhưng
            // vào biên tập/tải về vẫn y hệt bản cũ. Chỉ gọi setFilesSafe khi thực sự có thay đổi.
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
        } finally {
            setIsFixing(false);
        }
    };

    const isWorking = isScanning || isFixing || isProposing || isAnalyzingReq || isPreviewing;

    return {
        isAnalyzingReq, isScanning, isProposing, isFixing, isPreviewing, scanProgress,
        imageInputRef, fileInputRef,
        setRawErrors, setProcessedFixes, setPrompt,
        rawErrors, processedFixes, fixPrompt, fixImages,
        previewRules, togglePreviewRule, cancelPreview, setAllPreviewRulesEnabled,
        ruleFixSettings, setRuleFixSettings,
        handleImageUpload, handleUploadTxt, removeImage,
        handleAnalyzeRequirements, handleScan, handlePropose, applyFixesToTranslation,
        isWorking,
    };
};
