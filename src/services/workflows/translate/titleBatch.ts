// Tạo lại tiêu đề chương hàng loạt bằng AI (dùng model nhanh/rẻ - Flash).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo } from '../../../types';

export const generateTitleBatch = async (
    files: { id: string, content: string, currentHeader: string, originalRawHeader?: string }[],
    storyInfo: StoryInfo,
    onLog?: (msg: string) => void,
    enabledModels?: string[],
    shouldAbort?: () => boolean
): Promise<Map<string, { title: string, linesToReplace: number }>> => {
    if (files.length === 0) return new Map();

    const instruction = `Role: Senior Fiction Editor.
Task: Standardize chapter titles for a Vietnamese novel.
Input: A list of chapter excerpts (first 1000 chars).
Output: A list of STANDARDIZED titles.

FORMATTING RULES:
1. Format MUST be one of the following:
   - Chương [Number]: [Title Case Name]
   - Ngoại chương [Number]: [Title Case Name]
   - Phụ chương [Number]: [Title Case Name]
   - Tập [Number] - Chương [Number]: [Title Case Name]
2. CRITICAL: You MUST KEEP THE EXACT ORIGINAL CHAPTER NUMBER AND PREFIX. If it uses "Volume 1 - Chapter 1:", KEEP "Tập 1 - Chương 1:". Do NOT renumber or randomly modify.
3. CRITICAL: If the CURRENT_HEADER or ORIGINAL_RAW_HEADER contains text after the chapter number, THAT TEXT IS THE ORIGINAL TITLE. Format it to Title Case and add a colon if it makes sense.
4. CRITICAL AVOID GENERATION: If the original text ONLY has a chapter number (e.g., "Chương 420") with no title name, you MUST return exactly "Chương 420:" and DO NOT generate or invent a title.
5. CRITICAL AVOID GENERATION: If the original text has NO NUMBER AND NO TITLE at all, DO NOT invent a title. Leave the lines as they are (or return empty title string/same content).
6. CRITICAL AVOID MERGING CONTENT: Do NOT pull the first sentence of the story up into the title. If line 1 is "Chương X" and line 2 is dialogue (e.g., "Hello") or narrations, "linesToReplace" MUST be 1. Do NOT merge line 2 into the title.
7. DO NOT add any annotations, notes, or comments to the title.
8. Genre Context: ${storyInfo.genres.join(', ')}.
9. Return JSON Object: { "results": [ { "id": "file_id", "title": "Standardized Title OR Empty string if no title", "linesToReplace": 1 } ] }
10. "linesToReplace" indicates how many lines from the start of the file belong to the true title. If it's a 2-line title, return 2. If line 2 is story text, return 1.
11. CRITICAL: DO NOT mistake item quantities or numbers in the story for chapter titles (e.g., "10 Cuốn Khế Ước"). If there is no real title, return the string as is.
12. CRITICAL: If the CURRENT_HEADER is NOT a title (e.g., it's just story content, dialogue, or an item quantity like "10 Cuốn Thâm Uyên"), you MUST set "linesToReplace": 0. And importantly, DO NOT generate a new title. Just return empty string for the title.
13. CRITICAL: DO NOT mistake times (e.g., "9:00AM", "12:30"), dates, years (e.g., "400 năm sau"), or addresses for chapter titles. If the CURRENT_HEADER is a time, date, or address, set "linesToReplace": 0 and DO NOT generate a title.
14. CRITICAL: ABSOLUTELY DO NOT mix English words into the Vietnamese title (e.g., DO NOT use "But", "On", "The", "In"). The title MUST be 100% pure Vietnamese.
`;

    const inputs = files.map(f => {
        const regex = /^\s*\d+[\.\-\s]+(第\s*\d+\s*[章回节篇部卷折]|(?:Chương|Chapter|Ch|Tiết|Hồi|Phần)\s*\d+)/im;
        const cleanRaw = (f.originalRawHeader || 'N/A').replace(regex, '$1');
        const cleanCurr = f.currentHeader.replace(regex, '$1');
        const cleanContent = f.content.substring(0, 1500).replace(regex, '$1');
        return `ID: ${f.id}\nORIGINAL_RAW_HEADER:\n${cleanRaw}\nCURRENT_HEADER:\n${cleanCurr}\nCONTENT_SNIPPET:\n${cleanContent}...\n---`;
    }).join('\n');
    const prompt = `[INPUT DATA]\n${inputs}`;

    // Use Flash models for speed and cost effectiveness
    let candidates = ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].filter(id => enabledModels?.includes(id) ?? true);
    if (candidates.length === 0) candidates = ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']; // Fallback if none enabled

    return await smartExecution(candidates, async mid => {
        const ai = getAiClient();
        let timeoutId: NodeJS.Timeout | undefined;
        const connectionTimeout = new Promise<never>((_, reject) => {
            // Tạo tiêu đề chỉ là 1 tác vụ nhỏ/nhanh (không phải dịch full nội dung), nên timeout
            // ngắn hơn nhiều so với các tác vụ generate dài để tránh treo UI lâu khi mạng/API chậm.
            timeoutId = setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 120000); // 120s timeout
        });
        try {
            if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
            const resPromise = ai.models.generateContent({
                model: mid,
                contents: prompt,
                config: { 
                    systemInstruction: instruction, 
                    temperature: 0.4, // Slightly creative for title generation
                    responseMimeType: "application/json",
                    maxOutputTokens: 65536,
                    safetySettings: SAFETY_SETTINGS
                }
            });
            const res = await Promise.race([resPromise, connectionTimeout]) as any;
            if (timeoutId) clearTimeout(timeoutId);

            const map = new Map<string, { title: string, linesToReplace: number }>();
            try {
                const json = JSON.parse(res.text || "{}");
                if (json.results && Array.isArray(json.results)) {
                    json.results.forEach((item: any) => {
                        if (item.id && item.title !== undefined) {
                            const cleanTitle = item.title.replace(/\\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                            // FIX (tiêu đề bị nhân đôi khi model quên linesToReplace): mặc định cũ
                            // là 0 — useTitleNormalizer sẽ CHÈN tiêu đề mới mà không xoá dòng
                            // tiêu đề cũ ngay bên dưới (đầu chương bị trùng/garbage). Model đề
                            // xuất tiêu đề mới thì gần như luôn thay cho đúng 1 dòng tiêu đề cũ,
                            // nên mặc định 1; giữ nguyên 0 nếu model chủ động trả 0.
                            map.set(item.id, { title: cleanTitle, linesToReplace: item.linesToReplace ?? (cleanTitle ? 1 : 0) });
                        }
                    });
                }
            } catch (e) {
                // FIX (JSON hỏng bị nuốt thành "thành công"): trước đây parse lỗi chỉ log rồi
                // return map rỗng — smartExecution coi là kết quả tốt, KHÔNG thử lại bằng model
                // khác, cả lô chuẩn hoá tiêu đề lặng lẽ bỏ qua. Ném lỗi để vòng retry của
                // smartExecution thử candidate kế tiếp (caller đã có try/catch riêng).
                if (onLog) onLog(`❌ Lỗi parse JSON Title: ${e} — thử lại bằng model khác...`);
                throw e;
            }
            return map;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }, "Tạo tiêu đề (Flash)", onLog);
};
