// Dùng AI để kiểm tra lại chất lượng bản dịch của cả batch (bổ sung cho validate bằng regex/rule).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchDeepSeek } from '../../api/deepseek';
import { removeJunkForValidation } from '../../../utils/text';
import { EDITORIAL_NOTE_VALIDATION_POLICY } from '../../../utils/text/nonStoryPolicy';

// FIX (giãn cách batch hậu kiểm): trước đây các luồng hậu kiểm nhỏ (chia từ 1 batch dịch, vd
// 12 file -> 2 luồng 6 file) đều được bắn đi CÙNG LÚC qua Promise.all, không hề có độ trễ giữa
// các luồng. Gọi dồn dập nhiều request hậu kiểm cùng lúc dễ dính lỗi API thoáng qua (rate-limit/
// timeout) hơn, kéo theo hiện tượng báo oan cả lô đã sửa ở các fix trước. Hàm này bắn các luồng
// với độ trễ tăng dần vài giây giữa mỗi luồng (luồng đầu chạy ngay lập tức, không delay) thay vì
// hoàn toàn đồng thời — vẫn giữ được tính "song song" tổng thể (không tuần tự hoá hoàn toàn, tránh
// làm chậm không cần thiết) nhưng trải đều tải ra để giảm khả năng dính rate-limit.
const STAGGER_DELAY_MS = 2500; // "vài giây" giữa mỗi luồng hậu kiểm kế tiếp
const runStaggered = <T,>(items: T[], task: (item: T, idx: number) => Promise<void>, delayMs: number = STAGGER_DELAY_MS): Promise<void[]> => {
    return Promise.all(items.map((item, idx) => {
        if (idx === 0) return task(item, idx);
        return new Promise<void>(resolve => setTimeout(resolve, idx * delayMs)).then(() => task(item, idx));
    }));
};

// Thứ tự ưu tiên RIÊNG cho hậu kiểm Tier 2 (không ảnh hưởng thứ tự dịch/Auto-Fix ở FLASH_POOL,
// vốn dùng chung trường `priority` trong MODEL_CONFIGS). 3 model Flash đứng đầu (3.5 Flash Lite,
// 3.5 Flash, 3.1 Flash Lite) được xếp CÙNG 1 mức ưu tiên (1) thay vì tách bậc riêng từng model —
// lý do: `getBestModelForTask` tính điểm chọn model theo `effectivePriority * 100` là chính, phần
// tải gần đây (rpmLoad/rpdLoad) và "rotation penalty" (phạt nhẹ +0.5 nếu vừa dùng lại đúng model
// đó) chỉ lệch nhau tối đa ~1 điểm — nên hễ 2 model khác mức ưu tiên, chênh lệch 100 điểm/bậc sẽ
// luôn thắng tuyệt đối, khiến toàn bộ lượt hậu kiểm dồn hết vào đúng 1 model ưu tiên cao nhất cho
// tới khi model đó hết quota mới chuyển — dễ dính rate-limit dù các model khác vẫn còn dư quota.
// Khi 3 model này CÙNG mức ưu tiên, phần tải/rotation penalty (vốn đã có sẵn trong quotaManager)
// mới thực sự phát huy tác dụng: batch nào vừa dùng model nào sẽ bị phạt nhẹ, đẩy batch kế tiếp
// sang model ít tải hơn trong nhóm — phân bổ luân phiên tự nhiên giữa 3 model thay vì dồn 1 chỗ.
// Chỉ khi CẢ 3 đều hết quota/depleted mới rơi xuống 2 model Gemma (vẫn giữ thứ tự 31B trước 26B).
const HAU_KIEM_PRIORITY_OVERRIDE: Record<string, number> = {
    'gemini-3.5-flash-lite': 1,
    'gemini-3.5-flash': 1,
    'gemini-3.1-flash-lite': 1,
    'gemma-4-31b-it': 2,
    'gemma-4-26b-a4b-it': 3,
};

export const validateBatchWithAI = async (
    files: { id: string, content: string, name?: string }[],
    results: Map<string, string>,
    enabledModels: string[],
    onLog?: (msg: string) => void,
    translationModel?: string, // model (mid) đã dùng để dịch batch này, vd "deepseek:xxx" hoặc "gemini-3.5-flash"
    deepseekKey?: string,
    // Đề xuất cải thiện tồn đọng: khoảng nghỉ giữa các luồng hậu kiểm (mặc định STAGGER_DELAY_MS
    // như cũ nếu không truyền) - cho phép người dùng tinh chỉnh qua Cài Đặt thay vì cố định cứng.
    staggerDelayMs?: number
): Promise<Map<string, { isValid: boolean, reason?: string, unresolved?: boolean }>> => {
    // `unresolved: true` đánh dấu các entry được TỰ ĐIỀN BÙ bên dưới (Tier 2 không hề đưa ra
    // được kết luận thật - JSON hỏng, thiếu file_id, hết candidate model...), phân biệt với
    // entry `isValid: false` THẬT SỰ do AI so sánh nội dung và chủ động từ chối. Cả 2 đều dùng
    // isValid=false (để các luồng tiêu thụ cũ - vd streamTranslate.ts - không cần đổi gì, vẫn
    // coi "chưa chắc chắn" là nghi vấn/không hoàn tất như trước), nhưng caller nào cần phân biệt
    // "lỗi thật đã xác nhận" với "chưa xác định được" (vd startupTriage.ts quyết định thông báo
    // và khoá cứu hộ) thì đọc thêm cờ `unresolved` thay vì chỉ dựa vào `isValid`.
    const aiReport = new Map<string, { isValid: boolean, reason?: string, unresolved?: boolean }>();
    if (files.length === 0 || results.size === 0) return aiReport;

    // NEW: Nếu batch này vừa được dịch/cứu hộ bằng DeepSeek, hậu kiểm (Tier 2)
    // cũng PHẢI dùng lại đúng vệ tinh đó thay vì quay về Gemini. Lý do: nội dung đã bị Gemini
    // từ chối/lỗi mới phải "cứu hộ" qua vệ tinh, nên đưa nó quay lại Gemini để hậu kiểm sẽ dính
    // lại y hệt lỗi cũ (Safety Filter / rỗng nội dung), khiến bản dịch hợp lệ bị hậu kiểm đánh
    // rớt oan.
    const useDeepSeek = !!(translationModel && translationModel.startsWith('deepseek:') && deepseekKey && deepseekKey.trim().length > 0);

    let candidates: string[];
    if (useDeepSeek) {
        // Vệ tinh DeepSeek chỉ có đúng model vừa dịch thành công batch này.
        candidates = [translationModel!];
    } else {
        // Lọc ra các model được phép dùng cho hậu kiểm Tier 2. Thứ tự ưu tiên hậu kiểm dùng
        // HAU_KIEM_PRIORITY_OVERRIDE riêng (không đụng vào `priority` mặc định trong
        // MODEL_CONFIGS ở constants.ts, vì trường đó còn dùng chung cho FLASH_POOL của
        // dịch/Auto-Fix) — xem quotaManager.getBestModelForTask(priorityOverrides).
        // Thứ tự ưu tiên hậu kiểm: (3.5 Flash Lite = 3.5 Flash = 3.1 Flash Lite, phân bổ luân
        // phiên trong nhóm) > Gemma 31B > Gemma 26B.
        const targetModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
        candidates = targetModels.filter(m => enabledModels.includes(m) || enabledModels.length === 0);
    }

    if (candidates.length === 0) {
        if (onLog) onLog(`ℹ️ Bỏ qua kiểm tra AI (Tier 2) do không có model phù hợp (Gemma 4/Flash Lite/3.5 Flash) được bật.`);
        return aiReport;
    }

    // QUY TẮC CHIA HẬU KIỂM (Tier 2 AI) — tránh phí request:
    // - Batch <= 6 file VÀ tổng ký tự (gốc + dịch) <= ngân sách: hậu kiểm gộp 1 lượt duy nhất.
    // - Batch > 6 file hoặc vượt ngân sách ký tự: chia đôi đều, đệ quy tới khi mỗi lô vừa số file
    //   vừa vừa ngân sách (vd 7 -> 3+4, 8 -> 4+4, 12 -> 6+6), thay vì cứ 5 file/lượt như trước.
    // - FIX (hậu kiểm báo oan chương dài): trước đây chỉ chia theo SỐ FILE, nên 1 lô 6 chương dài
    //   (tác giả viết trên 10k raw/chương, người dùng lười tách nhỏ) dồn tới ~200-300k ký tự vào
    //   đúng 1 lượt gọi — model đối chiếu dở dang/lơ đãng dễ trả kết quả thiếu file_id hoặc nghi
    //   ngờ oan. Nay thêm NGÂN SÁCH KÝ TỰ cho mỗi lượt: lô nào quá nặng tự động chia nhỏ để mỗi
    //   lượt gọi có khối lượng vừa phải, AI đủ "sức" đối chiếu toàn văn cả đầu lẫn cuối.
    const MAX_CHUNK_TOTAL_CHARS = 180000; // tổng ký tự gốc+dịch tối đa cho 1 lượt hậu kiểm
    const splitForValidation = (list: { id: string, content: string, name?: string }[]): { id: string, content: string, name?: string }[][] => {
        if (list.length <= 1) return [list];
        const totalChars = list.reduce((sum, f) => sum + f.content.length + (results.get(f.id)?.length || 0), 0);
        if (list.length <= 6 && totalChars <= MAX_CHUNK_TOTAL_CHARS) return [list];
        const half1 = Math.floor(list.length / 2);
        const a = list.slice(0, half1);
        const b = list.slice(half1);
        return [...splitForValidation(a), ...splitForValidation(b)];
    };
    const chunks: { id: string, content: string, name?: string }[][] = splitForValidation(files);

    const rescueLabel = useDeepSeek ? ' qua DeepSeek (batch này được dịch bằng DeepSeek)' : '';
    if (onLog) onLog(`🤖 Đang hậu kiểm Batch bằng AI (Tier 2)${rescueLabel}... (Chia ${chunks.length} luồng nhỏ)`);

    // LỊCH SỬ: từng thử cắt cửa sổ đầu/cuối theo số ký tự cố định, rồi theo tỉ lệ giãn nở
    // Việt/Hán, rồi neo theo dòng phân cảnh (……/...) — cả 3 cách đều dựa vào một giả định
    // không giữ được trong thực tế: rằng có thể ĐOÁN đúng vị trí "điểm bắt đầu tương ứng" bên
    // kia chỉ từ độ dài hoặc từ một ký tự định dạng model có thể lược bỏ bất kỳ lúc nào (đã xác
    // nhận qua dữ liệu backup thật: bản dịch không hề giữ lại dấu "……"/"..." nên cách neo phân
    // cảnh cũng vô dụng với đúng ca lỗi nó được sinh ra để sửa). Hễ còn CẮT bớt nội dung trước
    // khi gửi cho AI hậu kiểm, tức là đang tự tạo nguy cơ cắt sai chỗ với các chương có chuyển
    // cảnh/POV giữa chương — và không có công thức đo lường nào loại bỏ được nguy cơ đó hoàn
    // toàn. Cách triệt để: KHÔNG đoán nữa — gửi NGUYÊN VĂN cả gốc lẫn dịch để AI tự đối chiếu,
    // chỉ giữ lại cắt bớt (rất rộng rãi) như một van an toàn cho các file dài bất thường (vd
    // paste nhầm nguyên cả tập/nhiều chương vào 1 file) để tránh phình prompt vô kiểm soát.
    const FULL_SEND_SRC_CAP = 15000;  // FIX (nới cap cho chương dài): nhiều tác giả viết chương
                                      // gốc trên cả 10k ký tự mà người dùng không tách nhỏ — cap
                                      // cũ 6k khiến các chương này rơi vào cửa sổ cắt đầu/cuối và
                                      // bị hậu kiểm báo oan "lệch chương". 15k đủ chứa chương dài
                                      // thường gặp, kể cả chương gộp 2-in-1.
    const FULL_SEND_TGT_CAP = 60000;  // dịch tiếng Việt thường dài gấp 2-4 lần bản Hán: 15k gốc
                                      // x3 = 45k, cap 60k chừa dư địa cho chương giãn mạnh (người
                                      // dùng yêu cầu nâng từ 50k lên 60k)
    const SAFETY_WINDOW = 8000;       // cửa sổ đầu/cuối RẤT rộng, chỉ áp dụng cho file vượt cap
                                      // (paste nhầm nguyên tập/nhiều chương vào 1 file)

    const buildPrompt = (chunkFiles: { id: string, content: string, name?: string }[]) => {
        let prompt = `Bạn là một chuyên gia kiểm định bản dịch truyện. Nhiệm vụ của bạn là SO SÁNH đối chiếu giữa bản gốc và bản dịch để phát hiện lỗi ghép sai chương.
Cụ thể, bạn cần đảm bảo:
1. Nội dung phần ĐẦU bản dịch phải dịch chính xác từ phần ĐẦU bản gốc.
2. Nội dung phần CUỐI bản dịch phải dịch chính xác từ phần CUỐI bản gốc.
3. CHÚ Ý TIÊU ĐỀ: Nhiều tác giả/trang web đánh số post tự động chèn trước tên chương (vd: "1149.第1147章..." trong khi tên đúng là 1147). Bản dịch lược bỏ số tiền tố này (thành "Chương 1147:...") là chính xác. KHÔNG báo lỗi ảo giác sai chương.
${EDITORIAL_NOTE_VALIDATION_POLICY}
5. ĐỊNH DẠNG TIÊU ĐỀ: Truyện gốc có thể thuộc 1 trong 3 dạng chương: (a) có số thứ tự + tên chương, (b) chỉ có số thứ tự không có tên, (c) không có tiêu đề gì cả (thuần văn bản). Ứng dụng dịch được PHÉP tự chuẩn hoá/format lại tiêu đề (thêm "Chương X:" hoặc đặt tên chương phù hợp) cho dạng (b) và (c). Việc bản dịch xuất hiện tiêu đề/số chương mà bản gốc không ghi rõ theo cách đó KHÔNG phải là dấu hiệu lệch nội dung, miễn là phần NỘI DUNG sau tiêu đề vẫn khớp với bản gốc.
6. THIÊN VỊ VỀ PHÍA "HỢP LỆ": Đây là bước kiểm tra CHỐNG GHÉP NHẦM CHƯƠNG, KHÔNG PHẢI chấm điểm chất lượng dịch thuật. Bạn KHÔNG cần bản dịch phải khớp từng chữ, chỉ cần khớp Ý và NHÂN VẬT/BỐI CẢNH chính giữa gốc và dịch. Nếu bạn CHỈ nghi ngờ mơ hồ, không chắc chắn tuyệt đối, hoặc bản dịch trông có vẻ ổn nhưng bạn không đối chiếu được hết do khác ngôn ngữ — PHẢI trả về isValid=true. CHỈ trả về isValid=false khi có bằng chứng RÕ RÀNG, CHẮC CHẮN rằng nội dung dịch nói về một tình huống/nhân vật HOÀN TOÀN KHÁC với bản gốc (dấu hiệu ghép nhầm chương thật sự). Báo sai một bản dịch ĐÚNG gây thiệt hại lớn hơn nhiều so với bỏ sót một bản dịch sai, vì nó làm mất một bản dịch tốt và tốn công dịch lại vô ích.
7. BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们) LÀ CỐT TRUYỆN, KHÔNG PHẢI LỖI: Nhiều truyện thuộc dạng "nhân vật chính phát trực tiếp trong game" (game/livestream/hệ thống) có xen kẽ NGUYÊN VĂN trong bản GỐC các đoạn bình luận/tên hô của khán giả, người xem, người chơi khác (vd 弹幕, 观众们说, biệt danh do khán giả đặt cho nhân vật chính...). Đây LÀ nội dung truyện thật, KHÔNG phải rác quảng cáo, và KHÔNG phải dấu hiệu bản dịch bịa thêm/lệch chương.
8. CHƯƠNG CÓ NHIỀU CẢNH/CHUYỂN POV: Một chương gốc hoàn toàn có thể chứa nhiều cảnh khác nhau, chuyển góc nhìn giữa các nhóm nhân vật (vd đoạn giữa chương nhảy sang cảnh phe phái khác đang họp bàn, rồi quay lại nhân vật chính). Đây là cấu trúc truyện BÌNH THƯỜNG, KHÔNG phải dấu hiệu ghép nhầm chương. Vì bạn được xem TOÀN BỘ nội dung (không phải trích đoạn), hãy tìm ĐOẠN KẾT THỰC SỰ (đoạn văn cuối cùng, ngay trước khi hết bản gốc) và đối chiếu đúng đoạn đó — không nhầm với một cảnh ở giữa chương.
TUYỆT ĐỐI KHÔNG đánh giá tính logic hay sự liền mạch của cốt truyện giữa đoạn đầu và đoạn cuối. Kể cả cốt truyện chuyển cảnh đột ngột ở bản gốc, chỉ cần bản dịch khớp với bản gốc thì vẫn là ĐÚNG.
9. VĂN PHONG THOÁT Ý/MƯỢT MÀ KHÔNG PHẢI LỖI: Bản dịch được yêu cầu dịch THOÁT Ý, viết lại câu cho mượt mà tự nhiên theo văn phong Việt (không dịch word-by-word bám sát trật tự câu gốc), và có thể chêm nhẹ teencode/tiếng lóng thông dụng khi hợp bối cảnh. Vì vậy bản dịch có thể: đảo trật tự câu/đoạn trong CÙNG một cảnh, gộp hoặc tách câu, đổi cách diễn đạt/thành ngữ, thêm/bớt từ đệm — miễn Ý, NHÂN VẬT, HÀNH ĐỘNG và BỐI CẢNH của đoạn đó vẫn đúng với bản gốc. Đây KHÔNG phải dấu hiệu ghép nhầm chương hay lệch nội dung. CHỈ báo isValid=false khi nội dung nói về tình huống/nhân vật/sự kiện HOÀN TOÀN KHÁC, không phải khi chỉ khác cách diễn đạt.

`;
        let countToValidate = 0;
        chunkFiles.forEach(f => {
            const targetContent = results.get(f.id);
            if (!targetContent) return;
            countToValidate++;

            let safeContent = f.content;
            safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
            safeContent = removeJunkForValidation(safeContent);
            const safeTarget = removeJunkForValidation(targetContent);

            const fitsFullSend = safeContent.length <= FULL_SEND_SRC_CAP && safeTarget.length <= FULL_SEND_TGT_CAP;

            prompt += `--- FILE ID: ${f.id} ---\n`;
            if (fitsFullSend) {
                // Trường hợp bình thường (đại đa số): gửi NGUYÊN VĂN, không đoán cửa sổ.
                prompt += `[GỐC - TOÀN BỘ]:\n${safeContent.trim()}\n\n`;
                prompt += `[DỊCH - TOÀN BỘ]:\n${safeTarget.trim()}\n\n`;
            } else {
                // Van an toàn cho file dài bất thường — cửa sổ RẤT rộng (4000 ký tự mỗi đầu,
                // mỗi bên) để giảm thiểu tối đa nguy cơ hụt cảnh, chỉ chấp nhận rủi ro nhỏ còn
                // sót lại thay vì gửi nguyên văn file cực lớn tốn prompt vô ích.
                const srcHead = safeContent.substring(0, SAFETY_WINDOW).trim();
                const srcTail = safeContent.substring(Math.max(0, safeContent.length - SAFETY_WINDOW)).trim();
                const tgtHead = safeTarget.substring(0, SAFETY_WINDOW).trim();
                const tgtTail = safeTarget.substring(Math.max(0, safeTarget.length - SAFETY_WINDOW)).trim();
                prompt += `[GỐC ĐẦU]:\n${srcHead}\n\n`;
                prompt += `[GỐC CUỐI]:\n${srcTail}\n\n`;
                prompt += `[DỊCH ĐẦU]:\n${tgtHead}\n\n`;
                prompt += `[DỊCH CUỐI]:\n${tgtTail}\n\n`;
            }
        });

        if (countToValidate === 0) return null;

        prompt += `Hãy trả về kết quả định dạng JSON chuẩn:
{
  "validations": {
    "file_id": {
      "isValid": true/false,
      "reason": "Giải thích ngắn gọn nếu false"
    }
  }
}`;
        return prompt;
    };

    const runValidationPass = async (
        chunkFiles: { id: string, content: string, name?: string }[],
        candidateList: string[],
        targetMap: Map<string, { isValid: boolean, reason?: string }>,
        depth: number = 0,
        retryCount: number = 0
    ) => {
        const prompt = buildPrompt(chunkFiles);
        if (!prompt) return;

        try {
            const jsonResultText = await smartExecution<string>(
                candidateList,
                async (modelId) => {
                    if (modelId.startsWith('deepseek:')) {
                        const deepseekModelName = modelId.replace('deepseek:', '');
                        const text = await fetchDeepSeek(
                            deepseekKey || "",
                            deepseekModelName,
                            "Bạn là một chuyên gia kiểm định bản dịch truyện. CHỈ trả lời bằng đúng 1 khối JSON hợp lệ theo định dạng được yêu cầu, không thêm lời dẫn hay giải thích ngoài JSON.",
                            prompt,
                            true // jsonMode
                        );
                        return text || "{}";
                    }
                    const ai = getAiClient();
                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: prompt,
                        config: { 
                            safetySettings: SAFETY_SETTINGS,
                            temperature: 0.1,
                            responseMimeType: "application/json",
                            // FIX (bug "hậu kiểm hay báo thiếu file_id dù bản dịch đã xong"): đây từng
                            // là chỗ DUY NHẤT trong toàn app gọi Gemini lấy JSON mà KHÔNG set
                            // maxOutputTokens (mọi nơi khác — context.ts, names.ts, autoAnalyze.ts,
                            // repair.ts, smartFixChunk.ts, streamTranslate.ts... — đều set cứng 65536).
                            // Vì mỗi lượt hậu kiểm gửi NGUYÊN VĂN gốc lẫn dịch của tối đa 6 file (full
                            // send cap tới 15000 ký tự gốc + 60000 ký tự dịch/file) để model đối chiếu,
                            // dùng giới hạn output MẶC ĐỊNH (thấp hơn nhiều) rất dễ khiến JSON trả về
                            // bị CẮT NGANG giữa chừng (thiếu dấu đóng cuối) — JSON.parse throw — và
                            // TOÀN BỘ 6 file trong lô bị đánh rớt oan dù nội dung dịch đã hoàn chỉnh.
                            maxOutputTokens: 65536
                        }
                    });
                    return response.text || "{}";
                },
                "AI Batch Validator",
                // FIX (đề xuất cải thiện - quan sát phân bổ model hậu kiểm): trước đây truyền
                // `undefined` ở đây ("no direct logs to avoid spam") khiến KHÔNG CÓ CÁCH NÀO quan
                // sát được model nào thực sự được chọn cho mỗi lô hậu kiểm — không thể xác minh cơ
                // chế luân phiên giữa 3 model Flash cùng mức ưu tiên (xem HAU_KIEM_PRIORITY_OVERRIDE
                // bên dưới) có hoạt động đúng như kỳ vọng hay không khi kiểm thử thực tế. SỬA: lọc
                // chỉ chuyển tiếp đúng dòng log "Đang chạy trên model" (bỏ qua mọi log nội bộ khác
                // của smartExecution - quota/backoff/retry...) để không spam nhật ký nhưng vẫn đủ
                // để người dùng grep/xem log xác nhận model có đang luân phiên đúng hay không.
                onLog ? (msg: string) => { if (msg.includes('Đang chạy trên model')) onLog(`[Hậu kiểm Tier 2] ${msg}`); } : undefined,
                // FIX (ghim model vô hiệu hoá luân phiên): trước đây truyền candidateList[0] làm
                // preferredModelId — kích hoạt nhánh "STRICT PREFERRED" của getBestModelForTask
                // (quotaManager.ts): CHỈ chờ đúng model đầu tiên khi nó đang RPM-cooldown thay vì
                // chuyển sang model khác còn rảnh, khiến HAU_KIEM_PRIORITY_OVERRIDE (3 model Flash
                // cùng mức ưu tiên, xem comment đầu file) gần như không bao giờ có tác dụng. Truyền
                // undefined để bộ chọn tự luân phiên theo điểm tải; thứ tự ưu tiên vẫn được đảm bảo
                // qua priorityOverrides.
                undefined,
                HAU_KIEM_PRIORITY_OVERRIDE
            );

            let parsed: any;
            try {
                const cleanJson = jsonResultText.replace(/```json/gi, '').replace(/```/g, '').trim();
                parsed = JSON.parse(cleanJson);
            } catch {
                // FIX (đi kèm maxOutputTokens ở trên): dù đã nâng cap lên 65536, vẫn có thể còn ca
                // JSON hỏng khác (model tự ý thêm rác ngoài JSON, lỗi mạng cắt giữa response...).
                // TRƯỚC ĐÂY: hỏng JSON của cả lô -> mặc định TOÀN BỘ file trong lô (tối đa 6 file)
                // bị đánh rớt oan, dù thủ phạm thực tế (nếu có) chỉ nằm ở 1 file khiến model lú/luẩn
                // quẩn khi so sánh. SỬA: nếu lô còn > 1 file, chia đôi rồi hậu kiểm lại riêng từng
                // nửa (đệ quy, chặn tối đa 3 lớp để tránh phình số lượt gọi API vô hạn) — thu hẹp
                // phạm vi "vạ lây" xuống còn đúng nửa nghi vấn, thay vì cả lô. Chỉ khi đã tách xuống
                // còn đúng 1 file mà vẫn hỏng thì mới thực sự chịu bó tay và đánh dấu nghi vấn.
                if (chunkFiles.length > 1 && depth < 3) {
                    if (onLog) onLog(`⚠️ JSON hậu kiểm lỗi/cắt ngang cho lô ${chunkFiles.length} file — chia đôi, hậu kiểm lại riêng từng nửa thay vì đánh rớt oan cả lô...`);
                    const half = Math.ceil(chunkFiles.length / 2);
                    const a = chunkFiles.slice(0, half);
                    const b = chunkFiles.slice(half);
                    await runStaggered([a, b], (half) => runValidationPass(half, candidateList, targetMap, depth + 1), staggerDelayMs);
                    return;
                }
                if (onLog) onLog(`⚠️ Không thể parse JSON từ AI Validator: ${jsonResultText.substring(0, 100)}`);
                return;
            }

            if (parsed && parsed.validations) {
                Object.keys(parsed.validations).forEach(key => {
                    targetMap.set(key, parsed.validations[key]);
                });
                // CHẨN ĐOÁN ("hậu kiểm không trả kết quả"): JSON hợp lệ nhưng THIẾU file_id là
                // nguyên nhân phổ biến nhất của hiện tượng này (model trả output không đầy đủ /
                // cắt giữa chừng / lơ đãng quên 1-2 id). Log rõ thiếu bao nhiêu + preview phản
                // hồi thô để lần sau có dữ liệu tra cứu thay vì chỉ thấy thông báo mơ hồ.
                const missingIds = chunkFiles.filter(cf => !parsed.validations[cf.id]).map(cf => cf.name || cf.id);
                if (missingIds.length > 0 && onLog) {
                    onLog(`⚠️ Validator trả JSON hợp lệ nhưng THIẾU ${missingIds.length}/${chunkFiles.length} file_id: ${missingIds.map(n => String(n).substring(0, 30)).join(' | ').substring(0, 150)}. Preview phản hồi: ${jsonResultText.substring(0, 120)}`);
                }
            }
        } catch(e: any) {
            // FIX (báo oan cả lô do lỗi gọi API thoáng qua — network/timeout/rate-limit tạm thời
            // khiến smartExecution throw dù model vẫn tốt): trước đây nhánh catch này KHÔNG hề
            // retry — khác với nhánh catch JSON-parse ở trên (đã có chia đôi + thử lại). Hễ
            // smartExecution ném lỗi 1 lần là cả lô (tối đa 6 file) bị bỏ trắng luôn, rồi rơi vào
            // quy tắc fail-closed phía dưới (không có entry -> tự động đánh nghi vấn), dù bản dịch
            // thực tế không hề sai — đúng hiện tượng người dùng báo cáo (luôn tạch tròn 6/12 file
            // theo đúng ranh giới 1 luồng chia đôi). SỬA: cho phép thử lại nguyên lô đúng 1 lần
            // trước khi thực sự bó tay, có chờ ngắn để tránh dính lại đúng lỗi thoáng qua vừa gặp.
            if (retryCount < 1) {
                if (onLog) onLog(`⚠️ Lỗi khi chạy AI Validator chunk (lô ${chunkFiles.length} file): ${e.message} — thử lại 1 lần trước khi đánh nghi vấn...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                await runValidationPass(chunkFiles, candidateList, targetMap, depth, retryCount + 1);
                return;
            }
            if (onLog) onLog(`⚠️ Lỗi khi chạy AI Validator chunk (lô ${chunkFiles.length} file) sau khi đã thử lại: ${e.message}`);
        }
    };

    // Lượt 1: hậu kiểm như bình thường (dùng candidates đã xác định ở trên - DeepSeek nếu batch
    // vừa dịch bằng DeepSeek, ngược lại Gemini Flash-Lite/Gemma). Các luồng nhỏ được giãn cách
    // vài giây (runStaggered) thay vì bắn đồng thời hoàn toàn, để giảm lỗi API thoáng qua.
    await runStaggered(chunks, chunk => runValidationPass(chunk, candidates, aiReport), staggerDelayMs);

    // FIX (fail-closed thay vì fail-open): nếu 1 chunk hậu kiểm gặp trục trặc — JSON không parse
    // được (dòng "catch" ở runValidationPass), gọi API lỗi hết toàn bộ candidate model, hoặc AI
    // trả JSON hợp lệ nhưng THIẾU hẳn 1 vài file_id trong "validations" (rất hay gặp khi model bị
    // cắt output giữa chừng ở batch nhiều file) — thì (các) file đó sẽ không có entry nào trong
    // aiReport. Trước đây điều này khiến file bị coi là "hợp lệ" một cách im lặng, vì vòng lặp tiêu
    // thụ kết quả ở streamTranslate.ts (aiValidationResults.forEach) chỉ chạy trên các entry THỰC
    // SỰ tồn tại trong Map — bỏ sót không có nghĩa là "AI xác nhận đúng", nhưng lại bị đối xử y hệt
    // như vậy. Chủ động điền các file bị thiếu bằng isValid=false + lý do rõ ràng ("chưa xác minh
    // được" chứ không phải "đã xác minh là đúng"), để file được đưa vào diện nghi vấn/dịch lại thay
    // vì lọt lưới. Đặt TRƯỚC Lượt 2 để các file bị điền bù này (nếu do vệ tinh DeepSeek
    // rớt) vẫn có cơ hội được Gemini xác nhận chéo lại thay vì bị đánh rớt oan luôn.
    files.forEach(f => {
        if (!aiReport.has(f.id)) {
            aiReport.set(f.id, {
                isValid: false,
                unresolved: true, // chưa từng được AI thực sự đối chiếu - KHÔNG phải lỗi đã xác nhận
                reason: "Hậu kiểm AI (Tier 2) không trả về kết quả cho file này (JSON thiếu file_id / lỗi gọi API / không parse được JSON) — tự động đánh dấu nghi vấn thay vì mặc định coi là hợp lệ."
            });
        }
    });

    // Lượt 2A (MỚI - fix21, gộp từ báo cáo "24 file bị lọc/đánh dấu oan bên cứu hộ vệ tinh"):
    // các file rơi vào diện `unresolved` (Tier 2 không hề đưa ra được kết luận thật ở lượt 1 - lỗi
    // gọi API/JSON hỏng ở CHÍNH lượt gọi kiểm định, KHÔNG PHẢI bị AI đối chiếu nội dung rồi chủ
    // động từ chối) chỉ là SỰ CỐ HẠ TẦNG thoáng qua - có thể xảy ra với BẤT KỲ nguồn dịch nào
    // (Gemini/DeepSeek). TRƯỚC ĐÂY: khối "Lượt 2"
    // xác nhận chéo bên dưới CHỈ chạy khi `useDeepSeek`, nên 1 batch dịch bằng
    // GEMINI mà Tier 2 gặp lỗi gọi API/JSON hỏng sẽ bị đóng khung "nghi vấn" ngay lập tức, không hề
    // có cơ hội thử lại - dù bản dịch gốc hoàn toàn ổn (đã xác nhận bằng cách đọc trực tiếp nội
    // dung 1 file mẫu bị báo cáo: dịch đầy đủ, không sót ký tự gốc). SỬA: cho MỌI file `unresolved`
    // (không điều kiện theo nguồn dịch) một lượt thử lại riêng bằng đúng bộ model Gemini
    // Flash-Lite/Gemma tiêu chuẩn của Tier 2, TRƯỚC KHI coi là nghi vấn thật - chỉ giữ nguyên trạng
    // thái "chưa xác định được" nếu lượt thử lại NÀY cũng không trả được kết quả (không tự suy ra
    // "lỗi thật đã xác nhận" chỉ vì không thử lại được, giữ đúng ý nghĩa gốc của cờ `unresolved`).
    const unresolvedIds = Array.from(aiReport.entries()).filter(([, v]) => v.unresolved).map(([id]) => id);
    if (unresolvedIds.length > 0) {
        const retryCandidates = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'].filter(m => enabledModels.includes(m) || enabledModels.length === 0);
        if (retryCandidates.length > 0) {
            if (onLog) onLog(`🔁 Thử lại hậu kiểm cho ${unresolvedIds.length} file chưa xác định được (lỗi gọi API/JSON ở lượt 1, không phải bị từ chối nội dung)...`);
            const filesToRetry = files.filter(f => unresolvedIds.includes(f.id));
            const retryReport = new Map<string, { isValid: boolean, reason?: string, unresolved?: boolean }>();
            const retryChunks = splitForValidation(filesToRetry);
            await runStaggered(retryChunks, chunk => runValidationPass(chunk, retryCandidates, retryReport), staggerDelayMs);

            unresolvedIds.forEach(id => {
                const retried = retryReport.get(id);
                if (retried) {
                    // Lượt thử lại NÀY trả về kết luận thật (dù hợp lệ hay nghi vấn thật) - dùng
                    // kết quả này thay cho trạng thái "chưa xác định" ban đầu.
                    aiReport.set(id, retried);
                    if (onLog) onLog(`${retried.isValid ? '✅' : '⚠️'} File ${id}: đã xác định được ở lượt thử lại (${retried.isValid ? 'hợp lệ' : 'nghi vấn thật'}).`);
                }
                // Nếu lượt thử lại cũng không trả được kết quả (retryReport không có entry cho id
                // này) - giữ nguyên trạng thái "chưa xác định được" ban đầu, không cần làm gì thêm.
            });
        }
    }

    // Lượt 2B (XÁC NHẬN CHÉO): CHỈ chạy khi lượt 1 dùng DeepSeek VÀ có ít nhất 1 file bị đánh
    // isValid=false. Lý do: model vệ tinh hay bị nhận thấy phán đoán sai khi phải so sánh nội dung
    // KHÁC NGÔN NGỮ (gốc Trung/Hàn/Nhật
    // vs dịch Việt) — kể cả khi dịch từng-file-một (không có nguy cơ hoán vị chéo), Tier 2 vẫn có
    // thể tự báo oan "trả nhầm kết quả" do chính model giám định yếu chứ không phải do bản dịch
    // sai thật. Gemini Flash-Lite (model thường dùng, đáng tin cậy hơn cho việc so khớp đa ngôn
    // ngữ) sẽ xác nhận lại — CHỈ giữ nguyên cờ nghi vấn khi CẢ 2 lượt cùng đồng ý là sai, nếu Gemini
    // xác nhận là hợp lệ thì lật ngược lại kết quả, tránh báo oan hàng loạt.
    if (useDeepSeek) {
        const rescueSourceLabel = 'DeepSeek';
        const failedIds = Array.from(aiReport.entries()).filter(([, v]) => !v.isValid).map(([id]) => id);
        if (failedIds.length > 0) {
            const geminiCandidates = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'].filter(m => enabledModels.includes(m) || enabledModels.length === 0);
            if (geminiCandidates.length > 0) {
                if (onLog) onLog(`🔎 Xác nhận chéo bằng Gemini cho ${failedIds.length} file bị ${rescueSourceLabel} nghi vấn (tránh báo oan do model giám định yếu)...`);
                const filesToRecheck = files.filter(f => failedIds.includes(f.id));
                const confirmReport = new Map<string, { isValid: boolean, reason?: string }>();
                const confirmChunks = splitForValidation(filesToRecheck);
                await runStaggered(confirmChunks, chunk => runValidationPass(chunk, geminiCandidates, confirmReport), staggerDelayMs);

                failedIds.forEach(id => {
                    const confirmed = confirmReport.get(id);
                    if (confirmed && confirmed.isValid) {
                        // Gemini KHÔNG đồng ý với nghi vấn ban đầu -> lật lại thành hợp lệ.
                        aiReport.set(id, { isValid: true, reason: `(Đã xác nhận chéo bằng Gemini: hợp lệ. Nghi vấn ban đầu từ ${rescueSourceLabel}: ${aiReport.get(id)?.reason || 'không rõ'})` });
                        if (onLog) onLog(`✅ File ${id}: Gemini xác nhận HỢP LỆ, huỷ nghi vấn ban đầu từ ${rescueSourceLabel}.`);
                    }
                    // Nếu Gemini cũng đồng ý là sai (hoặc không xác nhận được do lỗi/parse fail),
                    // giữ nguyên cờ nghi vấn ban đầu — không cần làm gì thêm.
                });
            } else if (onLog) {
                onLog(`ℹ️ Không có model Gemini nào để xác nhận chéo (đang chỉ dùng ${rescueSourceLabel}) — giữ nguyên kết quả hậu kiểm ban đầu.`);
            }
        }
    }

    return aiReport;
};
