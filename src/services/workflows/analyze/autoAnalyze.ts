// Quy trình TỰ ĐỘNG PHÂN TÍCH truyện khi mới thêm truyện (lấy mẫu chương, phân tích qua AI,
// trả về info + ảnh bìa gợi ý). Đây là hàm điều phối lớn (~195 dòng) — giữ nguyên khối, không
// tách nhỏ nội dung để tránh rủi ro đổi hành vi ở bước refactor thuần vị trí code này.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo, FileItem } from '../../../types';
import { safeJsonParse } from '../../../utils/text';
import { getSmartSampledFiles, chunkTextByFileBoundary } from '../../../utils/fileHelpers';
import { AUTO_ANALYZE_PROMPT } from '../../../constants';
import { AnalysisEngine, runDeepSeekWithFallback } from './engineDispatch';
import { isContentFilterFinishReason } from '../../../utils/contentFilterError';

export const autoAnalyzeStory = async (
    files: FileItem[],
    currentStoryInfo: StoryInfo,
    onProgress: (msg: string) => void,
    enabledModels?: string[],
    engine: AnalysisEngine = 'gemini',
    deepseekKey?: string,
    deepseekModel?: string
): Promise<{ info: any, cover: File | null, imagePrompt: string }> => {
    // FIX84: dùng lại 2 helper dùng chung với Phân Tích Sâu (context.ts) thay vì tự viết lại
    // logic lấy mẫu/cắt chunk riêng trong file này:
    // - getSmartSampledFiles: lấy mẫu Đầu/Giữa/Cuối theo tên file đã sort số (thay cho khối
    //   slice/Map thủ công cũ — cùng hành vi, chỉ gọn hơn và dùng chung 1 nguồn logic).
    // - chunkTextByFileBoundary: cắt theo RANH GIỚI CHƯƠNG — chỉ chuyển sang chunk mới ở ranh
    //   giới GIỮA 2 chương, không bao giờ xé đôi 1 chương giữa 2 lượt gọi AI như kiểu cắt cứng
    //   theo ký tự (content.substring) trước đây.
    const SAMPLE_HEAD = 50;
    const SAMPLE_MID = 50;
    const SAMPLE_TAIL = 50;
    const TOTAL_SAMPLE_THRESHOLD = SAMPLE_HEAD + SAMPLE_MID + SAMPLE_TAIL;

    if (files.length > TOTAL_SAMPLE_THRESHOLD) {
        onProgress(`Đang lấy mẫu (${SAMPLE_HEAD} đầu, ${SAMPLE_MID} giữa, ${SAMPLE_TAIL} cuối)...`);
    } else {
        onProgress(`Tổng số chương (${files.length}) < ${TOTAL_SAMPLE_THRESHOLD}. Đang phân tích toàn bộ truyện...`);
    }
    const sample = getSmartSampledFiles(files, { start: SAMPLE_HEAD, middle: SAMPLE_MID, end: SAMPLE_TAIL });

    // FIX84: bước Auto Phân Tích (nhanh) chỉ cần trích tag/thông tin tổng quan để tự điền form,
    // KHÔNG đòi hỏi độ chính xác cao như Phân Tích Sâu. Giữ ngưỡng riêng 600.000 ký tự/phần;
    // sau FIX87 giá trị này trùng với các luồng phân tích khác nhưng chính sách vẫn độc lập.
    const AUTO_ANALYZE_CHUNK_MAX_CHARS = 600000;
    const chunks = chunkTextByFileBoundary(sample.map(f => ({ text: f.content })), AUTO_ANALYZE_CHUNK_MAX_CHARS);

    const results: any[] = [];
    // FIX84: gửi TUẦN TỰ (Concurrency 1) cho cả Gemini lẫn DeepSeek — trước đây Gemini chạy 3
    // chunk song song mỗi đợt (Concurrency 3); nay mỗi phần đã rộng tới 600.000 ký tự (payload
    // lớn) nên gửi tuần tự để an toàn hơn trước rate limit.
    // Độ trễ 4000ms giữa các lượt gọi bên dưới vẫn giữ nguyên.
    const CONCURRENCY = 1;
    
    const totalBatches = Math.ceil(chunks.length / CONCURRENCY);

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batchNum = Math.floor(i / CONCURRENCY) + 1;
        const startPart = i + 1;
        const endPart = Math.min(i + CONCURRENCY, chunks.length);
        
        onProgress(`Đang phân tích Batch ${batchNum}/${totalBatches} (Phần ${startPart} - ${endPart})...`);

        const batch = chunks.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map((chunk) => {
            if (engine === 'deepseek') {
                const performDsAnalysis = async (): Promise<any> => {
                    const rawText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", AUTO_ANALYZE_PROMPT, chunk, true, onProgress);
                    let parsed = safeJsonParse(rawText || "");
                    if (!parsed) {
                        console.warn("safeJsonParse failed (DeepSeek), attempting AI JSON repair...");
                        const repairedText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", "Fix this invalid JSON and return ONLY valid JSON without markdown blocks.", rawText || "", true, onProgress);
                        parsed = safeJsonParse(repairedText || "");
                        if (!parsed) throw new Error("AI (DeepSeek) trả về kết quả không phải JSON hợp lệ.");
                    }
                    if (Array.isArray(parsed)) parsed = parsed[0];
                    return parsed;
                };
                return performDsAnalysis().catch(() => null);
            }

            // Use Flash models: 3.5 Flash and 3.0 Flash
            const flashModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
            if (flashModels.length === 0) flashModels.push('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');
            
            // Ưu tiên sử dụng 3.6 Flash làm model chính
            const performAnalysis = async (mid: string) => {
                try {
                    const res = await getAiClient().models.generateContent({ 
                        model: mid, 
                        contents: chunk + "\n" + AUTO_ANALYZE_PROMPT, 
                        config: { responseMimeType: 'application/json', safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 } 
                    });
                    
                    if (isContentFilterFinishReason(res.candidates?.[0]?.finishReason)) {
                        throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${res.candidates[0].finishReason}`);
                    }
                    
                    let parsed = safeJsonParse(res.text || "");
                    if (!parsed) {
                        console.warn("safeJsonParse failed, attempting AI JSON repair...");
                        // Attempt to repair JSON using AI
                        const repairRes = await smartExecution(flashModels, async (repairMid) => {
                            return await getAiClient().models.generateContent({
                                model: repairMid,
                                contents: "Fix this invalid JSON and return ONLY valid JSON without markdown blocks:\n\n" + (res.text || ""),
                                config: { responseMimeType: 'application/json', safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
                            });
                        });
                        parsed = safeJsonParse(repairRes.text || "");
                        if (!parsed) {
                            throw new Error("AI trả về kết quả không phải JSON hợp lệ.");
                        }
                    }
                    if (Array.isArray(parsed)) parsed = parsed[0];
                    return parsed;
                } catch (e) {
                    console.warn(`Analysis failed on ${mid}`, e);
                    throw e;
                }
            };

            return smartExecution(flashModels, performAnalysis, "Phân Tích Ngữ Cảnh", undefined, flashModels[0]).catch(() => null); 
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));
        
        // Add delay between batches to respect rate limits
        if (i + CONCURRENCY < chunks.length) await new Promise(r => setTimeout(r, 4000));
    }

    if (results.length === 0) {
        console.warn("All analysis batches failed. Returning default empty structure.");
        onProgress("Phân tích tự động thất bại. Vui lòng nhập thông tin thủ công.");
        throw new Error("Không thể phân tích dữ liệu (AI trả về kết quả rỗng hoặc lỗi định dạng). Vui lòng thử lại hoặc điền thủ công.");
    }
    
    onProgress(engine === 'deepseek' ? "Đang tổng hợp và tự điền thông tin (DeepSeek)..." : "Đang tổng hợp và tự điền thông tin (Gemini)...");

    const currentMeta = `[THÔNG TIN HIỆN TẠI TỪ NGƯỜI DÙNG]\nTên truyện hiện tại: ${currentStoryInfo.title || 'Chưa có'}\nTác giả hiện tại: ${currentStoryInfo.author || 'Chưa có'}\n\n`;
    const synthesisInstruction = `NHIỆM VỤ: Hợp nhất các kết quả JSON thành bản duy nhất chính xác nhất.
LƯU Ý QUAN TRỌNG:
1. TÁC GIẢ: Nếu [THÔNG TIN HIỆN TẠI TỪ NGƯỜI DÙNG] đã có Tên tác giả (khác 'Chưa có'), BẮT BUỘC giữ nguyên tên đó, TUYỆT ĐỐI KHÔNG sửa hoặc thay đổi.
2. TÊN TRUYỆN: 
   - Nếu văn bản là RAW (Ngoại ngữ) -> Dịch chuẩn sang tiếng Việt.
   - Nếu văn bản là CONVERT (Hán Việt thô) -> Edit lại cho thuần Việt, mượt mà, văn hay chữ tốt.
   - Ví dụ: "Ta Trù Thần, Tông Môn Trên Dưới Bị Thèm Khóc Rồi" -> Chuyển thành mượt mà như: "Ta Là Trù Thần, Toàn Tông Môn Đều Bị Ta Làm Thèm Khóc".`;

    let synthesis: any;
    if (engine === 'deepseek') {
        const dsSynthesisPrompt = currentMeta + JSON.stringify(results) + "\n\n" + AUTO_ANALYZE_PROMPT;
        const rawText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", synthesisInstruction, dsSynthesisPrompt, true, onProgress);
        let parsed = safeJsonParse(rawText || "");
        if (!parsed) {
            console.warn("safeJsonParse failed for synthesis (DeepSeek), attempting AI JSON repair...");
            const repairedText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", "Fix this invalid JSON and return ONLY valid JSON without markdown blocks.", rawText || "", true, onProgress);
            parsed = safeJsonParse(repairedText || "");
            if (!parsed) throw new Error("AI (DeepSeek) trả về kết quả tổng hợp không phải JSON hợp lệ.");
        }
        if (Array.isArray(parsed)) parsed = parsed[0];
        synthesis = parsed;
    } else {
        const fallbackModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
        if (fallbackModels.length === 0) fallbackModels.push('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');
        synthesis = await smartExecution(fallbackModels, async mid => {
            const res = await getAiClient().models.generateContent({ 
                model: mid, 
                contents: currentMeta + JSON.stringify(results) + "\n\n" + synthesisInstruction + "\n\n" + AUTO_ANALYZE_PROMPT, 
                config: { responseMimeType: 'application/json', safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 } 
            });
            
            if (isContentFilterFinishReason(res.candidates?.[0]?.finishReason)) {
                throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${res.candidates[0].finishReason}`);
            }
            
            let parsed = safeJsonParse(res.text || "");
            if (!parsed) {
                console.warn("safeJsonParse failed for synthesis, attempting AI JSON repair...");
                const repairRes = await getAiClient().models.generateContent({
                    model: 'gemini-3.7-flash',
                    contents: "Fix this invalid JSON and return ONLY valid JSON without markdown blocks:\n\n" + (res.text || ""),
                    config: { responseMimeType: 'application/json', safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
                });
                parsed = safeJsonParse(repairRes.text || "");
                if (!parsed) {
                    throw new Error("AI trả về kết quả tổng hợp không phải JSON hợp lệ.");
                }
            }
            if (Array.isArray(parsed)) parsed = parsed[0];
            return parsed;
        }, "Tổng Hợp Tự Động", undefined, fallbackModels[0]);
    }

    const formatSummary = (sumObj: any) => {
        if (!sumObj) return "";
        if (typeof sumObj === 'string') return sumObj;
        
        let formatted = "";
        if (sumObj.context) formatted += `📖 Tổng quan & Bối cảnh\n${sumObj.context}\n\n`;
        if (sumObj.main_plot) formatted += `⚔️ Hành trình nhân vật chính\n${sumObj.main_plot}\n\n`;
        if (sumObj.cultivation_system) formatted += `⚔️ Hệ thống tu luyện\n${sumObj.cultivation_system}\n\n`;
        if (sumObj.strengths) formatted += `✅ Điểm mạnh\n${sumObj.strengths}\n\n`;
        if (sumObj.conclusion) formatted += `📌 Nhận xét & Kết luận\n${sumObj.conclusion}`;
        return formatted.trim();
    };

    // Ensure all required fields exist and are of correct type.
    // NGUYÊN TẮC MERGE: ưu tiên giá trị NGƯỜI DÙNG/SMART START đã thiết lập trước đó, AI ở bước
    // "Auto Phân Tích" này chỉ có nhiệm vụ LẤP CHỖ TRỐNG khi thật sự CHƯA CÓ GÌ. Trước đây các
    // field contextNotes/additionalRules/genres/worldSetting/... bị ghi đè vô điều kiện bằng kết
    // quả AI của bước này — nếu người dùng vừa chạy Smart Start (đã build contextNotes/
    // additionalRules/chọn thể loại) rồi bấm chạy tiếp Automation, bước Auto Phân Tích (Step 1)
    // chạy ngay sau đó sẽ xoá sạch những gì Smart Start vừa làm (vì AI của bước này không trả về
    // các field đó, mặc định về rỗng), khiến bước Phân Tích Sâu (Step 2) chạy sau mất luôn ngữ
    // cảnh vừa xây — đây chính là hiện tượng "chồng chéo" giữa 2 luồng cũ (Smart Start) và mới
    // (Auto + Phân tích sâu). Áp dụng cùng 1 nguyên tắc "giữ cái đã có" cho mọi field, không chỉ
    // riêng author như trước.
    // BUGFIX: Khi tạo truyện mới (fileImport.ts / useCoreState.ts), languages/genres luôn được
    // khởi tạo mặc định là ['Tiếng Trung']/['Tiên Hiệp'] (placeholder chờ phân tích), CHỨ KHÔNG
    // phải do người dùng chọn. Logic cũ coi mảng "có length > 0" là "người dùng đã chọn" nên luôn
    // giữ nguyên 2 giá trị placeholder này và không bao giờ ghi đè bằng kết quả AI phân tích ra —
    // đây chính là lỗi "phân tích xong vẫn để nguyên Tiếng Trung / Tiên Hiệp". Chỉ coi là "người
    // dùng đã chọn" (và giữ nguyên) khi giá trị KHÁC với placeholder mặc định; nếu vẫn còn là
    // placeholder thì luôn ưu tiên thay bằng kết quả AI phân tích được (nếu có).
    const DEFAULT_LANGUAGES = ['Tiếng Trung'];
    const DEFAULT_GENRES = ['Tiên Hiệp'];
    const isSameAsDefault = (arr: string[] | undefined, def: string[]) =>
        Array.isArray(arr) && arr.length === def.length && arr.every((v, i) => v === def[i]);

    const finalInfo = {
        title: synthesis?.title || currentStoryInfo.title || "",
        author: currentStoryInfo.author || synthesis?.author || "", // Force keep current author if exists
        languages: (currentStoryInfo.languages && currentStoryInfo.languages.length > 0 && !isSameAsDefault(currentStoryInfo.languages, DEFAULT_LANGUAGES))
            ? currentStoryInfo.languages
            : (synthesis?.language_source ? [synthesis.language_source] : (Array.isArray(synthesis?.languages) && synthesis.languages.length > 0 ? synthesis.languages : (currentStoryInfo.languages || []))),
        genres: (currentStoryInfo.genres && currentStoryInfo.genres.length > 0 && !isSameAsDefault(currentStoryInfo.genres, DEFAULT_GENRES))
            ? currentStoryInfo.genres
            : (Array.isArray(synthesis?.genres) && synthesis.genres.length > 0 ? synthesis.genres : (currentStoryInfo.genres || [])),
        mcPersonality: (currentStoryInfo.mcPersonality && currentStoryInfo.mcPersonality.length > 0) ? currentStoryInfo.mcPersonality :
            (Array.isArray(synthesis?.personality) ? synthesis.personality : (Array.isArray(synthesis?.mcPersonality) ? synthesis.mcPersonality : [])),
        worldSetting: (currentStoryInfo.worldSetting && currentStoryInfo.worldSetting.length > 0) ? currentStoryInfo.worldSetting :
            (Array.isArray(synthesis?.setting) ? synthesis.setting : (Array.isArray(synthesis?.worldSetting) ? synthesis.worldSetting : [])),
        sectFlow: (currentStoryInfo.sectFlow && currentStoryInfo.sectFlow.length > 0) ? currentStoryInfo.sectFlow :
            (Array.isArray(synthesis?.flow) ? synthesis.flow : (Array.isArray(synthesis?.sectFlow) ? synthesis.sectFlow : [])),
        summary: currentStoryInfo.summary || formatSummary(synthesis?.summary),
        // Giữ nguyên contextNotes/additionalRules nếu Smart Start (hoặc người dùng) đã thiết lập
        // trước đó — đây là 2 field bị "chồng chéo" nghiêm trọng nhất giữa Smart Start và luồng
        // Auto/Phân tích sâu trước khi có fix này.
        contextNotes: currentStoryInfo.contextNotes || synthesis?.contextNotes || "",
        additionalRules: currentStoryInfo.additionalRules || synthesis?.suggested_rules || synthesis?.additionalRules || "",
        image_prompt: "", // Giữ key cũ để không phá vỡ chỗ khác đang đọc field này (nếu có)
        imagePrompt: currentStoryInfo.imagePrompt || "" // Tên field đúng theo StoryInfo — trước đây bị đặt sai tên (image_prompt) nên không bao giờ map được, mặc định về rỗng mỗi lần chạy
    };

    return { info: finalInfo, cover: null, imagePrompt: "" };
};
