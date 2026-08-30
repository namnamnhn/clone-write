// Nhóm hàm liên quan PROMPT/QUY TẮC dịch: tối ưu prompt, tinh chỉnh additionalRules, tóm tắt.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo } from '../../../types';
import { replacePromptVariables } from '../../../prompts';
import { AnalysisEngine, runDeepSeekWithFallback } from './engineDispatch';

// Fix "Gemini Math Mode" hallucination: đôi khi model (cả Gemini lẫn DeepSeek) trả về ký hiệu
// mũi tên dạng LaTeX ("\rightarrow", "$\rightarrow$") thay vì mũi tên Unicode "→" hay "->" thường,
// khiến các mục Tóm Tắt / Quy Tắc Bổ Sung / Prompt Tối Ưu hiển thị rác kiểu "$\rightarrow$" ra UI.
// QUAN TRỌNG VỀ THỨ TỰ: phải xử lý case CÓ dấu "$" bao quanh TRƯỚC case KHÔNG có dấu "$", nếu
// không dấu "\rightarrow" trần sẽ bị thay trước, khiến "$\rightarrow$" chỉ còn lại "$->$" (sót
// cặp dấu $ mồ côi) thay vì "->" sạch sẽ như mong đợi.
export const sanitizeAiMathArtifacts = (text: string): string => {
    if (!text) return text;
    return text
        .replace(/\$\\rightarrow\$/g, '->')
        .replace(/\\rightarrow/g, '->')
        .replace(/\(#\)/g, '')
        .replace(/[\*\#]/g, '');
};

// FIX61+: nhãn hiển thị cho ngôn ngữ nguồn RAW — dùng để khoá prompt tối ưu vào ĐÚNG
// (các) ngôn ngữ của dự án thay vì liệt kê chung chung "Trung/Anh/Hàn/Nhật..." khiến AI
// dịch phân tán và prompt phình to với những hướng dẫn không bao giờ dùng tới.
const RAW_SOURCE_LANG_LABELS: { key: string; label: string }[] = [
    { key: 'tiếng trung', label: 'TIẾNG TRUNG' },
    { key: 'tiếng anh', label: 'TIẾNG ANH' },
    { key: 'tiếng nhật', label: 'TIẾNG NHẬT' },
    { key: 'tiếng hàn', label: 'TIẾNG HÀN' },
];

export const resolveRawSourceLanguages = (languages: string[]): string[] => {
    const out: string[] = [];
    for (const l of languages || []) {
        const norm = (l || '').trim().toLowerCase();
        const hit = RAW_SOURCE_LANG_LABELS.find(x => norm === x.key || norm.includes(x.key));
        if (hit && !out.includes(hit.label)) out.push(hit.label);
    }
    return out;
};

export interface OptimizePromptInstructionInput {
    modeDirective: string;
    originRestorationDirective: string;
    additionalRules: string;
    dictionary: string;
    context: string;
    filledTemplate: string;
    rawSamples?: string[];
}

// FIX61+ (thiết kế Prompt Tối Ưu phải PHÙ HỢP BỘ TRUYỆN — phản hồi người dùng về bản
// "Vé Số Cào" vẫn còn mục Phụ Đề SRT dù là truyện chữ, và ghi chung chung "Trung/Anh/Hàn/Nhật"
// dù raw chỉ có tiếng Trung): tách phần dựng chỉ thị thành hàm thuần để test hồi quy trực tiếp.
// Chính sách chọn lọc 3 NHÓM A/B/C: giữ trọn lõi an toàn (A), mặc định giữ quy tắc điều kiện (B),
// CHỈ xoá khi có bằng chứng điều kiện kích hoạt bất khả thi với dữ liệu dự án (C — vd SRT với
// truyện chữ). Kèm mẫu raw thật để AI quyết định dựa trên bằng chứng chứ không đoán mò.
export const buildOptimizePromptInstruction = (input: OptimizePromptInstructionInput, storyInfo: StoryInfo): string => {
    const { modeDirective, originRestorationDirective, additionalRules, dictionary, context, filledTemplate } = input;
    const rawSamples = (input.rawSamples || []).filter(s => s && s.trim());
    const hasSamples = rawSamples.length > 0;

    const rawSamplesBlock = hasSamples
        ? `[DỮ LIỆU RAW MẪU (trích THẬT từ các tệp đầu vào của dự án — đối chiếu để xác nhận ngôn ngữ/định dạng thực tế và quyết định nhóm B/C theo chính sách ở mục 0)]\n${rawSamples.map((s, i) => `--- Mẫu ${i + 1} ---\n${s}`).join('\n\n')}\n\n`
        : '';

    return `Bạn là một Kỹ sư Prompt và Chuyên gia Ngôn ngữ học Văn học (Series Architect).
NHIỆM VỤ: Kiến trúc lại Prompt dịch thuật thành bản GỌN, CHÍNH XÁC RIÊNG cho bộ truyện này: tuỳ biến sâu phần văn phong/persona theo Series Bible, đồng thời GIỮ TRỌN lớp quy tắc lõi bảo vệ nội dung & cấu trúc xuất bản — và CHỈ lược bỏ đúng những quy tắc KHÔNG THỂ dùng tới cho dự án này theo chính sách chọn lọc ở mục 0.

${modeDirective}

0. **CHÍNH SÁCH CHỌN LỌC THEO BỘ TRUYỆN (ĐỌC TRƯỚC KHI VIẾT — QUAN TRỌNG NHẤT):** Nhiệm vụ KHÔNG phải sao chép lại mọi thứ trong [PROMPT GỐC CẦN TỐI ƯU], mà là kiến trúc lại thành Prompt NGẮN GỘN, ĐÚNG DỰ ÁN. Phân loại mọi nội dung của prompt gốc vào 3 nhóm sau:
   - **NHÓM A — LÕI AN TOÀN (BẮT BUỘC GIỮ 100%, cấm xoá/gộp mất ý):** các cơ chế áp dụng cho MỌI chương của dự án, KỂ CẢ khi các chương mẫu chưa gặp ví dụ (prompt sẽ tái sử dụng cho hàng trăm chương sau): đồng bộ thẻ ID [[[part_X]]] & chống lẫn lộn nội dung giữa thẻ; Clean Output (cấm AI chêm lời dẫn/bình luận); chống ngắt dịch sớm ngay sau bảng thông số hệ thống / khối bình luận khán giả-người chơi; **quy tắc 4d chỉ lược lời biên tập ngoài truyện ở ranh giới, mặc định giữ khi mơ hồ và tuyệt đối bảo vệ nội dung/chú thích thật**; bảo toàn chú thích gốc tác giả + cú pháp "[n]"; **check chính tả toàn văn ngay trước khi xuất**; phân biệt hội thoại/nội tâm/hệ thống ("..." / *một sao* / **hai sao**); nhất quán đơn vị số đếm; chuẩn hoá dấu câu lặp/ngoặc kép/dấu gạch ngang Trung Quốc; **gộp dòng rác bị gãy giữa câu (KHÔNG PHẢI tóm tắt) nhưng cấm gộp đoạn văn/lượt thoại riêng biệt**; cấm ALL CAPS & cấm rò rỉ ngoại ngữ; ghi đè xưng hô theo chế độ đã chọn; chống văn phong convert; cùng các mục tự kiểm tra/checklist tương ứng.
   - **NHÓM B — QUY TẮC ĐIỀU KIỆN ("NẾU gặp X thì xử lý Y"):** MẶC ĐỊNH GIỮ (chi phí rất thấp, chương sau có thể gặp — ví dụ: quy tắc chữ số thay thế chữ do lỗi font raw, xử lý văn bản ngắn được giao riêng...). Chỉ được XOÁ khi có BẰNG CHỨNG RÕ từ metadata + [DỮ LIỆU RAW MẪU] rằng điều kiện kích hoạt KHÔNG THỂ xảy ra với dữ liệu của dự án này. Riêng quy tắc 4d về lời ngoài truyện là NHÓM A, không được xoá.
   - **NHÓM C — LOẠI khi bất khả thi (XOÁ SẠCH là ĐÚNG, không coi là thiếu sót):** quy tắc dành cho định dạng/dữ liệu KHÔNG THỂ xuất hiện trong loại dự án này. Ví dụ điển hình: mục "ĐỊNH DẠNG PHỤ ĐỀ SRT" (khối số thứ tự + mã thời gian "00:00:03,500 --> ...") — phụ đề chỉ phục vụ sub phim; nếu bằng chứng cho thấy đây là TRUYỆN CHỮ (raw mẫu là các chương truyện liền mạch, không có khối mã thời gian) thì XOÁ HẲN mục này khỏi Prompt tối ưu.
   - **Nguyên tắc phân vân:** "chưa thấy ví dụ ở chương mẫu" KHÁC với "không thể xảy ra" → chưa thấy ví dụ vẫn là NHÓM B, GIỮ. Chỉ rơi vào NHÓM C khi điều kiện kích hoạt mâu thuẫn trực tiếp với bản chất dữ liệu đầu vào (loại tệp/ngôn ngữ/định dạng). Khi vẫn phân vân giữa giữ và xoá → GIỮ.
   - **TINH GIẢN ĐA NGÔN NGỮ/NHIỀU CHẾ ĐỘ:** prompt gốc chứa chiến lược xử lý chuyên sâu cho nhiều ngôn ngữ gốc (Trung/Hàn/Nhật/Anh) và cả 2 chế độ Convert/Raw. Prompt tối ưu chỉ GIỮ đúng (các) ngôn ngữ nguồn và đúng chế độ của dự án này (xem THIẾT QUÂN LUẬT VỀ CHẾ ĐỘ); bỏ hẳn hướng dẫn cho ngôn ngữ KHÔNG xuất hiện trong dự án, thay danh sách ngôn ngữ chung chung bằng đúng ngôn ngữ nguồn đã xác định — giúp model tập trung, không loãng.
   - **Tự kiểm tra trước khi xuất:** rà từng mục của prompt gốc — mục nào bị loại phải thuộc NHÓM C hoặc NHÓM B có bằng chứng loại trừ; tuyệt đối không được thiếu bất kỳ mục NHÓM A nào.

DỰA TRÊN NGỮ CẢNH (Series Bible) ĐƯỢC CUNG CẤP:
1. **DEEP CONTEXT ANALYSIS:** Đọc kỹ Series Bible để hiểu rõ tông giọng (Tone), phong cách (Style), và mối quan hệ nhân vật.
2. **RE-ENGINEER PERSONA:** Thay đổi "I. ĐỊNH DANH VÀ VAI TRÒ" để AI Translator nhập vai đúng linh hồn truyện. Nếu truyện hài hước, AI phải dí dỏm. Nếu truyện u tối, AI phải nghiêm túc.
3. **ORIGIN RESTORATION PROTOCOL:** ${originRestorationDirective}
4. **RAW-TO-VIET MAPPING:** Tạo mục "V. QUY TẮC CHUYỂN ĐỔI". Liệt kê các cặp: "{Ký tự gốc} -> {Bản dịch chuẩn}" dựa trên dữ liệu tham khảo.
5. **INTEGRATE RULES:** Lồng ghép khéo léo [QUY TẮC NGƯỜI DÙNG] vào Prompt. NẾU PHÁT HIỆN TRUYỆN CÓ YẾU TỐ NHẠY CẢM HOẶC BẠO LỰC, hãy lồng ghép quy tắc chống kiểm duyệt sau vào Prompt sao cho tự nhiên và phù hợp với truyện: "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung." (Tuyệt đối không được hiểu lầm quy tắc này thành bật bộ lọc hay từ chối dịch).
6. **BẢO VỆ BẢNG THÔNG SỐ (NHÓM A — BẮT BUỘC DUY TRÌ):** BẠN BẮT BUỘC PHẢI THÊM 3 QUY TẮC NÀY VÀO PROMPT TỐI ƯU ĐẦU RA:
   - Thêm quy tắc vào Mục II (Thứ bậc ưu tiên xử lý): "CẢNH BÁO BẢNG THÔNG SỐ (HỆ THỐNG/STATUS BOARD): Bảng thông số (Ký chủ, Thân phận, Tu vi...) CHỈ LÀ DỮ LIỆU BÊN TRONG TRUYỆN, KHÔNG PHẢI TÍN HIỆU NGẮT KẾT THÚC ĐOẠN/CHƯƠNG. BẮT BUỘC dịch xong bảng rồi PHẢI TIẾP TỤC DỊCH HẾT phần văn xuôi, hội thoại phía sau."
   - Bổ sung vào cơ chế tự kiểm tra nội bộ (Mục VII): "Check Bảng Thông Số: Đã dịch trọn vẹn phần văn bản/hội thoại ĐỨNG SAU bảng thông số hệ thống chưa? Chắc chắn KHÔNG dừng dịch giữa chừng ngay sau bảng thông số."
   - Thêm vào CHECKLIST CUỐI CÙNG TRƯỚC KHI XUẤT: "- [ ] KHÔNG ngắt ngang bản dịch tại bảng thông số hệ thống, ĐÃ dịch toàn bộ văn xuôi phía sau chưa?"
7. **CHUẨN HÓA DẤU CÂU LẶP LẠI - GIỮ CẢM XÚC (NHÓM A — BẮT BUỘC DUY TRÌ):** BẠN BẮT BUỘC PHẢI THÊM QUY TẮC NÀY VÀO PROMPT TỐI ƯU: "CRITICAL: Khi bản gốc có dấu câu lặp lại QUÁ DÀI (10+ dấu chấm, 6+ dấu than/hỏi liên tiếp), rút gọn về mức chuẩn ngữ pháp: dấu chấm lửng -> ĐÚNG 3 DẤU CHẤM ('...') (đây LÀ dấu câu chuẩn, không phải lỗi); dấu than/hỏi lặp thể hiện cảm xúc mạnh -> TỐI ĐA 3 dấu ('!!!' / '???'). TUYỆT ĐỐI KHÔNG rút gọn xuống còn 1 dấu duy nhất vì sẽ làm mất hẳn sắc thái cảm xúc/ngập ngừng của câu văn; nếu bản gốc chỉ có 1 dấu thì giữ nguyên 1 dấu, không tự ý thêm. Vẫn phải rút gọn chuỗi quá dài để tránh kích hoạt bộ lọc chống lặp (anti-hallucination) gây ngắt kết nối, nhưng rút về mức tối đa nêu trên chứ không phải 1 dấu."
8. **BẢO VỆ KHỐI BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们 — NHÓM B, MẶC ĐỊNH GIỮ):** BẠN BẮT BUỘC PHẢI THÊM 3 QUY TẮC NÀY VÀO PROMPT TỐI ƯU ĐẦU RA (đây là quy tắc điều kiện — chỉ cân nhắc XOÁ theo chính sách Nhóm B nếu thể loại + raw mẫu chứng minh KHÔNG THỂ có khối bình luận xen kẽ):
   - Thêm quy tắc vào Mục II (Thứ bậc ưu tiên xử lý): "CẢNH BÁO KHỐI BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们): Nếu văn bản gốc xen kẽ đoạn bình luận của khán giả/người xem/người chơi khác (thường ở truyện dạng nhân vật chính phát trực tiếp trong game/hệ thống), đây CHỈ LÀ MỘT ĐOẠN CHÊM trong mạch truyện, KHÔNG PHẢI TÍN HIỆU KẾT THÚC CHƯƠNG. BẮT BUỘC dịch đủ khối bình luận rồi PHẢI TIẾP TỤC DỊCH HẾT phần cốt truyện chính (hành động, hội thoại nhân vật, diễn biến) ngay sau đó cho tới hết chương, không được dừng lại ngay sau khối bình luận."
   - Bổ sung vào cơ chế tự kiểm tra nội bộ (Mục VII): "Check Bình Luận Khán Giả: Nếu đoạn văn có khối bình luận khán giả/người chơi, đã dịch trọn vẹn phần cốt truyện chính ĐỨNG SAU khối đó chưa? Chắc chắn KHÔNG dừng dịch giữa chừng ngay sau khối bình luận."
   - Thêm vào CHECKLIST CUỐI CÙNG TRƯỚC KHI XUẤT: "- [ ] KHÔNG ngắt ngang bản dịch ngay sau khối bình luận khán giả/người chơi, ĐÃ dịch toàn bộ cốt truyện chính phía sau chưa?"
9b. **ĐỒNG BỘ ID FILE (NHÓM A — BẮT BUỘC DUY TRÌ NGUYÊN VẸN) & XỬ LÝ RIÊNG MỤC SRT:** (a) khối "ĐỒNG BỘ ID FILE & CHỐNG LẪN LỘN" dạy AI giữ nguyên 100% thẻ ID dạng [[[part_X]]]...[[[/part_X]]] khi dịch nhiều file gộp batch, chống lẫn lộn nội dung giữa các thẻ — GIỮ NGUYÊN VẸN trong Prompt tối ưu (có thể diễn đạt lại câu chữ nhưng không được mất ý/case nào). (b) Riêng khối "ĐỊNH DẠNG PHỤ ĐỀ SRT" xử lý theo chính sách NHÓM B/C ở mục 0: chỉ giữ khi dự án thực sự có khả năng chứa dữ liệu phụ đề (.srt — xem metadata + [DỮ LIỆU RAW MẪU]); nếu bằng chứng rõ đây là truyện chữ thuần thì XOÁ HẲN mục này khỏi Prompt tối ưu — đây là hành vi ĐÚNG theo chính sách, KHÔNG được coi là thiếu sót và cũng KHÔNG được giữ lại "cho chắc" làm prompt phình to vô ích.
9c. **BẢO TOÀN NGUYÊN VẸN QUY TẮC PHÂN BIỆT HỘI THOẠI/NỘI TÂM VÀ NHẤT QUÁN ĐƠN VỊ SỐ ĐẾM (NHÓM A — BẮT BUỘC DUY TRÌ):** Prompt gốc (mục 12 và 13) có 2 khối quy tắc kỹ thuật bắt buộc khác: (a) "NHẤT QUÁN ĐƠN VỊ SỐ ĐẾM LỚN" — chỉ dùng 1 hệ đơn vị (vạn/ức HOẶC nghìn/triệu/tỷ) xuyên suốt 1 chương/bộ truyện, kể cả trong bảng thông số; (b) "QUY TẮC PHÂN BIỆT HỘI THOẠI VÀ NỘI TÂM" — hội thoại "..." KHÔNG in nghiêng, nội tâm bọc *một sao* (in nghiêng), hệ thống/thông báo bọc **hai sao** (in đậm), để công cụ xuất EPUB/DOCX nhận diện đúng chỗ cần in nghiêng/in đậm khi đóng sách. Đây cũng là 2 khối quy tắc AN TOÀN KỸ THUẬT (ảnh hưởng trực tiếp tới chất lượng file xuất bản) — GIỮ NGUYÊN VẸN nội dung 2 quy tắc này trong Prompt tối ưu đầu ra, có thể diễn đạt lại câu chữ cho khớp văn phong bộ truyện nhưng KHÔNG được rút gọn ý, gộp mất, hay bỏ sót bất kỳ trường hợp nào (hội thoại/nội tâm/hệ thống, hoặc 2 hệ đơn vị số).
9d. **BẢO TOÀN NGUYÊN VẸN QUY TẮC PHÂN BIỆT CHÚ THÍCH GỐC TÁC GIẢ, CẤM AI TỰ CHÈN CHÚ THÍCH, VÀ CÚ PHÁP ĐỊNH DẠNG CHÚ THÍCH (MỤC VIII — NHÓM A — BẮT BUỘC DUY TRÌ):** Prompt gốc (mục VIII) có 3 vế quy tắc PHẢI đi liền với nhau, không được chỉ giữ 1-2 vế: (a) CẤM AI TỰ SÁNG TẠO/CHÈN THÊM chú thích, ghi chú người dịch, lời dẫn mới không có trong bản gốc; (b) NHƯNG NẾU bản GỐC có sẵn chú thích/giải thích THẬT của tác giả (bối cảnh, thuật ngữ, thế giới quan...), đây LÀ nội dung truyện, BẮT BUỘC phải dịch và giữ lại nguyên vẹn, KHÔNG được xóa chỉ vì nó là "chú thích"; (c) CÚ PHÁP ĐỊNH DẠNG BẮT BUỘC cho chú thích gốc đã giữ lại — dấu chú thích trong câu văn viết thành "[n]", nội dung dịch tách thành dòng riêng "[n]: nội dung đã dịch" đặt ở cuối chương (trước thẻ đóng ID FILE), đánh số n tuần tự từ 1 mỗi chương — đây là quy tắc KỸ THUẬT XUẤT BẢN (công cụ xuất EPUB dựa vào đúng cú pháp "[n]" / "[n]: ..." này để tự động tạo link chú thích + nút quay lại (popup note) trong file EPUB, sai cú pháp sẽ khiến chú thích không được nhận diện và bị in lẫn vào văn bản thường). GIỮ NGUYÊN VẸN cả 3 vế trong Prompt tối ưu đầu ra, có thể diễn đạt lại câu chữ cho khớp văn phong bộ truyện nhưng TUYỆT ĐỐI KHÔNG được bỏ sót vế (b) hay đổi khác cú pháp "[n]" / "[n]: ..." ở vế (c), dù các chương mẫu chưa xuất hiện chú thích gốc nào.
9e. **BẢO TOÀN NGUYÊN VẸN QUY TẮC XỬ LÝ KÝ TỰ SỐ THAY THẾ CHỮ DO LỖI FONT RAW (NHÓM B — MẶC ĐỊNH DUY TRÌ):** Prompt gốc (mục 12) có quy tắc kỹ thuật: khi raw bị lỗi font chống-copy khiến một chữ Hán (phổ biến nhất là "灵"/Linh) hiển thị/copy ra thành ký tự SỐ ĐƠN LẺ đứng độc lập, vô nghĩa về ngữ pháp tại vị trí đó (không phải số đếm/thời gian/tiền bạc hợp lệ), AI phải dựa vào ngữ cảnh suy luận đúng nghĩa chữ bị mất và dịch đúng, TUYỆT ĐỐI KHÔNG chép nguyên ký tự số đó sang bản dịch — đồng thời KHÔNG được tự ý sửa các con số hợp lệ khác vì nhầm là lỗi font. MẶC ĐỊNH GIỮ quy tắc này trong Prompt tối ưu (lỗi font raw rất hay gặp ở truyện chữ); chỉ cân nhắc XOÁ theo chính sách Nhóm B nếu raw mẫu chứng minh chắc chắn không có hiện tượng này, có thể diễn đạt lại câu chữ cho khớp văn phong bộ truyện nhưng không được đổi bản chất quy tắc hay xóa ví dụ minh hoạ.
9f. **BẢO TOÀN NGUYÊN VẸN QUY TẮC GỘP DÒNG RÁC BỊ GÃY (MỤC 0.2 — NHÓM A — BẮT BUỘC DUY TRÌ, DỄ BỊ HIỂU NHẦM THÀNH TÓM TẮT NÊN PHẢI GIỮ RÕ RÀNG):** Prompt gốc (mục 0.2) có quy tắc: khi bản raw/convert bị lỗi bố cục khiến một câu văn hoàn chỉnh bị chẻ vụn thành nhiều dòng ngắn rời rạc, AI phải NỐI LẠI thành câu liền mạch (chỉ xoá dấu xuống dòng thừa, giữ nguyên 100% số từ/ý) — nhưng TUYỆT ĐỐI KHÔNG được gộp các đoạn văn đã trọn ý, KHÔNG được gộp hai lượt thoại "..." khác nhau của nhân vật, và KHÔNG bao giờ được coi đây là lệnh tóm tắt/rút gọn/diễn giải lại nội dung. GIỮ NGUYÊN VẸN cả phần "được gộp" lẫn phần "cấm gộp" trong Prompt tối ưu đầu ra, có thể diễn đạt lại câu chữ cho khớp văn phong bộ truyện nhưng KHÔNG được làm mất ranh giới giữa "nối câu bị gãy" và "tóm tắt nội dung" — đây là 2 hành vi hoàn toàn khác nhau và lẫn lộn sẽ khiến AI dịch tự ý cắt xén truyện.
9g. **ĐỒNG BỘ QUY TẮC LỌC LỜI NGOÀI TRUYỆN (MỤC 4d — NHÓM A — BẮT BUỘC DUY TRÌ):** Prompt tối ưu phải giữ đủ cả bốn hàng rào: (a) chỉ được lược một dải dòng độc lập sát đầu/cuối chương, không lọc giữa chương; (b) chỉ lược lời biên tập rõ ràng như xin nghỉ/lịch đăng/đổi tên, xin phiếu-ủng hộ, cảm ơn/quay thưởng, quảng bá/credit hoặc tâm sự đời tư không mang thông tin truyện; (c) nếu mơ hồ thì giữ và dịch, không phán theo từ khoá đơn lẻ; (d) bắt buộc giữ tự sự/hội thoại/cảnh truyện, ngoại truyện-hậu ký có nội dung, bình luận/thông báo hệ thống thuộc cốt truyện, giải thích thế giới quan-nhân vật-thuật ngữ-tình tiết và chú thích/footnote thật. Đồng thời giữ quy tắc: nếu toàn bộ file ngắn vẫn được giao riêng để dịch thì dịch sát nghĩa, không tự trả rỗng. Không được rút gọn mục này thành câu chung chung kiểu “lọc tâm sự tác giả”.
9h. **CHECK CHÍNH TẢ CUỐI (NHÓM A — BẮT BUỘC DUY TRÌ):** Prompt tối ưu phải có một bước riêng trong INTERNAL CHECKLIST và một ô trong CHECKLIST CUỐI: ngay trước khi trả kết quả, model đọc lại ngầm toàn bộ từng câu tiếng Việt và sửa sạch lỗi chính tả/đánh máy/dấu thanh/từ dễ nhầm (s/x, ch/tr, d/gi/r, hỏi/ngã; “suy nghĩ”/“suy nghỉ”, “chót vót”/“trót vót”). Chỉ xuất bản dịch đã sửa, không kể lại quá trình kiểm tra. Không được coi yêu cầu chung “văn phong mượt” là đủ rồi xoá bước kiểm tra cuối này.
9. **BẢO TOÀN & TÙY CHỈNH QUY TẮC VĂN PHONG TỰ NHIÊN (NHÓM A):** Prompt gốc có quy tắc nền tảng: dịch/biên tập phải thoát ý, mượt mà, nghệ thuật câu từ, không cụt lủn/thô ráp/word-by-word; hạn chế Hán Việt tối nghĩa ít thông dụng (trừ tên riêng/địa danh/thuật ngữ đã xác định qua Series Bible/từ điển); được dùng teencode/tiếng lóng/thuật ngữ mượn (hack, cheat, bug...) ở mức độ nhẹ, thông dụng, không lạm dụng. BẠN BẮT BUỘC GIỮ NGUYÊN tinh thần quy tắc này trong Prompt tối ưu, đồng thời TÙY CHỈNH LẠI cho phù hợp với bộ truyện cụ thể (dựa trên Series Bible, từ điển và [QUY TẮC NGƯỜI DÙNG] ở trên) — ví dụ: nêu rõ mức độ/loại teencode-tiếng lóng nào hợp với bối cảnh truyện này (đô thị/học đường/game thì có thể dùng nhiều hơn; cổ trang/nghiêm túc thì gần như không dùng), và liệt kê cụ thể hơn những cụm Hán Việt nào nên tránh hay nên giữ dựa trên văn phong đã phân tích được.
10. **DANH SÁCH HÁN VIỆT CỤ THỂ CHO BỘ TRUYỆN NÀY (BẮT BUỘC — không chỉ dừng ở lời khuyên chung chung của mục 9):** Đọc kỹ [DỮ LIỆU THAM KHẢO (SERIES BIBLE)] ở trên (đã gồm cả từ điển), rồi bổ sung vào phần V (Raw-to-Viet Mapping) của Prompt tối ưu 2 danh sách cụ thể, dựa trên các cụm Hán Việt/convert thô THỰC SỰ xuất hiện trong dữ liệu tham khảo (không bịa ví dụ chung chung không liên quan tới truyện này):
   - **"HÁN VIỆT CẦN THAY" (thô/tối nghĩa, xuất hiện trong dữ liệu tham khảo, cần đổi sang thuần Việt):** liệt kê 5-15 cặp cụ thể dạng "{cụm Hán Việt/convert thô} -> {từ thuần Việt thay thế}" lấy trực tiếp từ raw/dữ liệu tham khảo của TRUYỆN NÀY (không phải ví dụ minh hoạ có sẵn trong prompt gốc) — nếu dữ liệu tham khảo không đủ để tìm ra cặp cụ thể nào, ghi rõ "Chưa đủ dữ liệu mẫu để liệt kê cụ thể, áp dụng nguyên tắc chung ở trên" thay vì bịa ví dụ không có thật.
   - **"HÁN VIỆT ĐƯỢC GIỮ" (tên riêng/địa danh/chiêu thức/thuật ngữ đã xác định qua Series Bible/từ điển, PHẢI giữ nguyên âm Hán Việt):** liệt kê các thuật ngữ cố định của TRUYỆN NÀY (lấy từ từ điển/Series Bible) cần giữ nguyên, để AI Translator không nhầm lẫn áp dụng quy tắc "hạn chế Hán Việt" vào đúng những từ này.

ĐẦU VÀO:
- Tên: ${storyInfo.title} | Thể loại: ${storyInfo.genres.join(', ')}
[QUY TẮC NGƯỜI DÙNG BẮT BUỘC]
${additionalRules}

[DỮ LIỆU THAM KHẢO (SERIES BIBLE)]
${dictionary.substring(0, 20000)}
${context.substring(0, 50000)}

${rawSamplesBlock}[PROMPT GỐC CẦN TỐI ƯU]
${filledTemplate}`;
};

export const optimizePrompt = async (
  promptTemplate: string,
  storyInfo: StoryInfo,
  context: string = "",
  dictionary: string = "",
  additionalRules: string = "",
  enabledModels?: string[],
  engine: AnalysisEngine = 'gemini',
  deepseekKey?: string,
  deepseekModel?: string,
  rawSamples?: string[]
): Promise<string> => {
  // User requested 3.1 Pro. We keep 3.0 Pro as a high-quality backup, but remove 2.5 to ensure quality.
  const candidates = ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
  if (candidates.length === 0) candidates.push('gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');
  const filledTemplate = replacePromptVariables(promptTemplate, storyInfo);
  const isGameOrWestern = storyInfo.genres.some(g => ['Light Novel', 'Isekai', 'Fantasy', 'Đồng Nhân', 'Võng Du', 'Game'].includes(g)) || storyInfo.worldSetting.some(s => ['Phương Tây/Magic', 'Võng Du/Game'].includes(s));
  
  // DETECT MODE STRICTLY
  const lang = storyInfo.languages.join(' ').toLowerCase();
  const isConvert = lang.includes('convert') || lang.includes('cv') || lang.includes('thô');
  const isRaw = lang.includes('trung') || lang.includes('anh') || lang.includes('nhật') || lang.includes('hàn') || lang.includes('raw') || lang.includes('chinese') || lang.includes('english');

  let modeDirective = "";
  if (isConvert) {
      modeDirective = `
### 🛑 THIẾT QUÂN LUẬT VỀ CHẾ ĐỘ (MODE LOCK):
- Dữ liệu đầu vào được xác định là: **CONVERT / TIẾNG VIỆT THÔ**.
- **YÊU CẦU BẮT BUỘC:** Hãy viết lại Prompt để **CHỈ SỬ DỤNG CHẾ ĐỘ 1 (BIÊN TẬP / REWRITE)**.
- **HÀNH ĐỘNG CỤ THỂ:** XÓA BỎ hoàn toàn các chỉ thị liên quan đến "DỊCH THUẬT" (TRANSLATE) hoặc "CHẾ ĐỘ 2".
- Prompt mới phải tập trung tuyệt đối vào việc: Đọc hiểu văn bản tiếng Việt lủng củng -> Viết lại thành văn bản tiếng Việt mượt mà, đúng ngữ pháp.`;
  } else if (isRaw) {
      // FIX61+: khoá đúng (các) ngôn ngữ nguồn của dự án thay vì liệt kê chung chung.
      const langs = resolveRawSourceLanguages(storyInfo.languages);
      const langLine = langs.length > 0 ? langs.join(', ') : 'ngoại ngữ (tự nhận diện từ dữ liệu)';
      modeDirective = `
### 🛑 THIẾT QUÂN LUẬT VỀ CHẾ ĐỘ (MODE LOCK):
- Dữ liệu đầu vào được xác định là: **RAW / NGOẠI NGỮ**.
- **(CÁC) NGÔN NGỮ NGUỒN CỦA DỰ ÁN NÀY:** ${langLine}${rawSamples?.length ? ' (đối chiếu thêm với [DỮ LIỆU RAW MẪU] bên dưới)' : ''}.
- **YÊU CẦU BẮT BUỘC:** Hãy viết lại Prompt để **CHỈ SỬ DỤNG CHẾ ĐỘ 2 (DỊCH THUẬT / TRANSLATE)**.
- **HÀNH ĐỘNG CỤ THỂ:** XÓA BỎ hoàn toàn các chỉ thị liên quan đến "BIÊN TẬP" (REWRITE) hoặc "CHẾ ĐỘ 1".
- Phần xác định nhiệm vụ trong Prompt mới phải ghi đúng (các) ngôn ngữ nguồn nêu trên — KHÔNG liệt kê thêm bất kỳ ngôn ngữ nào khác không thuộc dự án (tránh prompt phình to và AI phân tán chờ đợi thứ không bao giờ xuất hiện).`;
  } else {
      modeDirective = `
### ⚠️ CẢNH BÁO CHẾ ĐỘ:
- Không xác định rõ nguồn Convert hay Raw. Hãy giữ nguyên cơ chế "Tự động xác định" (Dual Mode) trong Prompt để AI tự quyết định khi chạy.`;
  }

  const originRestorationDirective = isGameOrWestern
      ? `Truyện bối cảnh phương tây/game. QUY TẮC: 'KHÔNG HÁN VIỆT HÓA TÊN TIẾNG ANH'. (Goblin -> Goblin/Yêu tinh, Cấm: Ca Bố Lâm).`
      : `Truyện phong cách Trung Quốc. Duy trì Hán Việt chuẩn.`;

  const instruction = buildOptimizePromptInstruction({
      modeDirective,
      originRestorationDirective,
      additionalRules,
      dictionary,
      context,
      filledTemplate,
      rawSamples
  }, storyInfo);

  if (engine === 'deepseek') {
      try {
          const dsText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", instruction, "Thực hiện kiến trúc lại Prompt dựa trên Series Bible.", false);
          return sanitizeAiMathArtifacts(dsText?.trim() || filledTemplate);
      } catch (e) {
          console.warn("DeepSeek failed for optimizePrompt, giữ nguyên prompt gốc.", e);
          return filledTemplate;
      }
  }

  const ai = getAiClient();
  try {
      const proModels = ['gemini-3.1-pro-preview'].filter(id => enabledModels?.includes(id) ?? true);
      if (proModels.length === 0) proModels.push('gemini-3.1-pro-preview');

      const performTask = async (modelId: string) => {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: "Thực hiện kiến trúc lại Prompt dựa trên Series Bible.",
          config: { systemInstruction: instruction, temperature: 0.7, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 },
        });
        return sanitizeAiMathArtifacts(response.text?.trim() || filledTemplate);
      };

      try {
          return await smartExecution(proModels, performTask, "Optimize Prompt (Pro)", undefined, proModels[0]);
      } catch (e) {
          console.warn("Pro model failed for optimizePrompt, falling back to Flash.", e);
          const fallbackModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
          if (fallbackModels.length === 0) fallbackModels.push('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');
          return await smartExecution(fallbackModels, performTask, "Optimize Prompt (Flash)", undefined, fallbackModels[0]);
      }
  } catch {
      return filledTemplate;
  }
};

export const refineAdditionalRules = async (
    additionalRules: string, mergedContext: string, storyInfo: StoryInfo, enabledModels?: string[],
    forcedCandidates?: string[], pronounOverride?: string,
    engine: AnalysisEngine = 'gemini', deepseekKey?: string, deepseekModel?: string
): Promise<string> => {
    // UPDATED: "Quy Tắc Bổ Sung" chuyển giao cho 3.7 Flash phụ trách chính (không còn dùng 3.1 Pro
    // cho tác vụ này — 3.1 Pro chỉ còn giữ vai trò ở bước "Thiết Kế Prompt Tối Ưu" (optimizePrompt)).
    const flashModels = (forcedCandidates || ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']).filter(id => !id.includes('pro') && (enabledModels?.includes(id) ?? true));
    if (flashModels.length === 0) flashModels.push('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');

    const hasExistingRules = additionalRules && additionalRules.trim().length > 0;

    // Khi người dùng đã chọn tuỳ chọn xưng hô cố định (Hiện đại/Cổ đại) ở bước Phân Tích Sâu,
    // GHI ĐÈ hẳn khối hướng dẫn phân loại 3 NHÓM (A/B/C) mặc định của mục 4 — nếu vẫn giữ cả 2
    // (mặc định + override) trong cùng prompt, chỉ dẫn "phân loại theo bối cảnh" bên dưới có thể
    // lấn át phần override và khiến mục "4. Xưng hô" bị sinh ra lẫn lộn cả 2 kiểu.
    const pronounSection = pronounOverride
        ? `4. Xưng hô: (Chi tiết cách xưng hô của Main với kẻ thù, người thân, tiền bối...)\n\n${pronounOverride}`
        : `4. Xưng hô: (Chi tiết cách xưng hô của Main với kẻ thù, người thân, tiền bối... QUAN TRỌNG: Phải khớp 100% với bối cảnh, phân loại theo 4 NHÓM sau:
   - NHÓM A (Cổ trang Trung Hoa/Kiếm hiệp/Tiên hiệp, KỂ CẢ Dị giới/Xuyên không nhưng thế giới đến có bản chất kiếm hiệp/tiên hiệp/cổ trang Trung Hoa - tông môn, tu luyện, giang hồ): TUYỆT ĐỐI dùng ta - ngươi, vãn bối - tiền bối, huynh đệ, tỷ muội... CẤM dùng anh - em, tôi - cậu.
   - NHÓM B (Hiện đại/Đô thị/Thập niên 80-90, bối cảnh Trái Đất đời thực): dùng xưng hô hiện đại (chú, dì, anh, em, tôi).
   - NHÓM C (Light Novel Hàn/Nhật/Anh, Fantasy/Dị giới/Học viện phương Tây - KHÔNG phải Trung Hoa cổ trang, KHÔNG phải hiện đại Trái Đất): BẮT BUỘC dùng xưng hô tự nhiên kiểu phương Tây/light novel (tôi/ta - ngài/cô/cậu/anh, tiểu thư, ngài + tước hiệu, huân tước, bệ hạ nếu có hoàng gia). TUYỆT ĐỐI CẤM dùng xưng hô Hán Việt kiểu kiếm hiệp (tiền bối, hậu bối, vãn bối, huynh đệ, tỷ muội) cho nhóm này.
   - NHÓM D (Y tế/Sức khỏe, Mỹ thực, Khoa học - bối cảnh đời thực chuyên môn, KHÔNG phải kiếm hiệp, KHÔNG phải light novel/phương Tây): dùng nền xưng hô hiện đại đời thường như NHÓM B (chú, dì, anh, em, tôi) LÀM GỐC, kèm thêm sắc thái chuyên môn phù hợp: Y tế/Sức khỏe dùng xưng hô Bệnh nhân-Nhân viên y tế trang trọng hơn (Bác sĩ/Thưa bác sĩ) trừ khi 2 nhân vật đã thân thiết; Mỹ thực/Khoa học dùng nền NHÓM B, chỉ trang trọng hơn khi là quan hệ nghề nghiệp/học thuật (đầu bếp-khách, giáo sư-sinh viên).)`;

    const prompt = `Bạn là một chuyên gia thiết kế Prompt và biên tập viên văn học.
Nhiệm vụ của bạn là ${hasExistingRules ? 'tinh chỉnh, hoàn thiện và bổ sung' : 'tạo ra'} "Quy Tắc Bổ Sung" (Additional Rules) cho việc dịch thuật/biên tập truyện dựa trên "Ngữ Cảnh" (Context) đã được phân tích chi tiết.

[THÔNG TIN TRUYỆN]
Tên truyện: ${storyInfo.title}
Tác giả: ${storyInfo.author}
Thể loại: ${storyInfo.genres?.join(', ') || ''}

[NGỮ CẢNH ĐÃ PHÂN TÍCH]
${mergedContext}

${hasExistingRules ? `[QUY TẮC BỔ SUNG HIỆN TẠI]\n${additionalRules}\n` : ''}
[YÊU CẦU QUAN TRỌNG VỀ THIẾT KẾ PROMPT (ADVANCED LINGUISTIC PROCESSING)]
Bạn PHẢI áp dụng "Động cơ ngôn ngữ nội tại" chuyên biệt hóa cho dòng ngôn ngữ gốc/bản convert của truyện này (nếu có thể nhận dạng) vào phần 1 (Ngôn ngữ / Văn phong) để đảm bảo bản dịch KHÔNG BỊ SƯỢNG, KHÔNG WORD-BY-WORD (WBW):
- NẾU LÀ BẢN CONVERT (Tiếng Việt thô, VP): Yêu cầu AI biên tập thoát ý, sắp xếp lại trật tự Chủ-Vị-Tân chuẩn Việt, loại bỏ cấu trúc "bị... hắn...", sửa từ gốc Hán Việt thô cứng (ví dụ: kiến quỷ, hãn nhan, nhượng nhân tâm hàn) đổi về thành ngữ/từ thuần Việt mượt mà, gọt giũa hội thoại bỏ hư từ dư thừa ("đích", "của").
- NẾU GỐC TRUNG: Nhấn mạnh việc giữ âm Hán Việt cho danh xưng, chiêu thức, địa danh; nhưng phải dùng thuần Việt 100% cho miêu tả hành động, cảm xúc. Cấm dùng Hán Việt dư thừa cho hội thoại đời thường. Mạnh dạn yêu cầu ngắt câu dài lê thê đặc trưng của văn Trung.
- NẾU GỐC HÀN: Yêu cầu AI nối câu rơi vãi/vỡ vụn (đặc trưng xuống dòng liên tục của Hàn), dịch chuẩn xác kính ngữ ẩn vào giọng điệu (Anh/Chị/Tiền bối đi kèm dạ/vâng/ạ), KHÔNG dịch WBW thán từ "ah", "oh", "kuku...". Chú ý trật tự động từ cuối câu phải lật lại đúng ngữ pháp Việt.
- NẾU GỐC NHẬT: Lọc sạch "Anime Slop" và đại từ nhân xưng dư thừa (watashi, ore...). Không dịch lậm wibu quá đà nếu bối cảnh nghiêm túc. CRITICAL: BẮT BUỘC giữ nguyên hậu tố kính ngữ (-san, -kun, -chan, -sama, -sensei...) sát tên riêng (áp dụng chung với cả Hàn, LN nếu có), KHÔNG dịch sang tiếng Việt để bảo toàn văn hóa truyện. Diễn giải Việt hóa tự nhiên phần nội tâm.
- NẾU GỐC ANH: Yêu cầu AI xóa bỏ Passive Voice (Câu bị động) dư thừa, không lạm dụng đại từ sở hữu (tay của hắn, mắt của nàng), dịch slang và idioms theo hướng lấy ý (localization) chứ không dịch nghĩa đen.

[YÊU CẦU CẤU TRÚC PROMPT OUTPUT]
BẮT BUỘC trình bày chính xác theo cấu trúc 6 phần sau (trả về dưới dạng text Markdown có đánh số):
Mở đầu: "Đây là truyện [Nguồn gốc] thuộc thể loại [Các thể loại]."
1. Ngôn ngữ / Văn phong: (Đề xuất văn phong, kết hợp sâu sắc các quy tắc xử lý ngôn ngữ chuyên biệt ở trên để câu cú thoát ý, mượt mà, thuần Việt, tuyệt đối không bị sượng hay WBW điển hình của ngôn ngữ đó).
2. Tên nhân vật & địa danh: (Quy tắc dùng Hán Việt, Romaji, hay tên Anh/Gốc...)
3. Thuật ngữ đặc trưng: (Hệ thống, kỹ năng, món ăn, vật phẩm... cần giữ nguyên hay dịch thuần Việt)
${pronounSection}
5. Lưu ý bối cảnh: (Các yếu tố đa thể loại, chuyển đổi ngữ cảnh...)
6. Xử lý nội dung nhạy cảm (CẢNH BÁO QUAN TRỌNG): (Dựa trên ý tưởng gốc sau đây, BẠN PHẢI TINH CHỈNH VÀ VIẾT LẠI câu này sao cho thật mượt mà, văn vẻ và phù hợp với thể loại, bối cảnh riêng của bộ truyện này: "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.")

CHỈ TRẢ VỀ NỘI DUNG QUY TẮC BỔ SUNG theo đúng format trên, không thêm lời chào hỏi hay giải thích dư thừa. KHÔNG bọc trong block code markdown (như \`\`\`markdown).`;

    if (engine === 'deepseek') {
        try {
            const dsText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", "Bạn là một chuyên gia thiết kế Prompt và biên tập viên văn học.", prompt, false);
            const text = (dsText || additionalRules).replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
            return sanitizeAiMathArtifacts(text);
        } catch (e) {
            console.warn("DeepSeek failed for refineAdditionalRules, giữ nguyên quy tắc gốc.", e);
            return additionalRules;
        }
    }

    const performTask = async (modelId: string) => {
        const response = await getAiClient().models.generateContent({
            model: modelId,
            contents: prompt,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
        });
        let text = response.text || additionalRules;
        text = text.replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
        return sanitizeAiMathArtifacts(text);
    };

    try {
        return await smartExecution(flashModels, performTask, "Quy Tắc Bổ Sung (Flash)", undefined, flashModels[0]);
    } catch (e) {
        console.warn("Flash models failed for refineAdditionalRules, falling back to Pro.", e);
        const fallbackModels = ['gemini-3.1-pro-preview'].filter(id => enabledModels?.includes(id) ?? true);
        if (fallbackModels.length === 0) fallbackModels.push('gemini-3.1-pro-preview');
        return await smartExecution(fallbackModels, performTask, "Quy Tắc Bổ Sung (Pro)", undefined, fallbackModels[0]);
    }
};


export const refineSummary = async (
    mergedContext: string, storyInfo: StoryInfo, enabledModels?: string[], forcedCandidates?: string[],
    engine: AnalysisEngine = 'gemini', deepseekKey?: string, deepseekModel?: string
): Promise<string> => {
    // UPDATED: "Tóm Tắt Truyện" chuyển giao cho 3.7 Flash phụ trách chính (không còn dùng 3.1 Pro
    // cho tác vụ này — 3.1 Pro chỉ còn giữ vai trò ở bước "Thiết Kế Prompt Tối Ưu" (optimizePrompt)).
    const flashModels = (forcedCandidates || ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']).filter(id => !id.includes('pro') && (enabledModels?.includes(id) ?? true));
    if (flashModels.length === 0) flashModels.push('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');

    const prompt = `Dựa trên toàn bộ [Ngữ cảnh chi tiết] sau đây, hãy viết một bản tóm tắt truyện thật chi tiết và đầy đủ. Vì đây là ngữ cảnh từ toàn bộ câu chuyện (đầu-giữa-cuối), bạn KHÔNG ĐƯỢC rút gọn. Hãy trình bày theo cấu trúc các mục sau, mỗi mục có thể viết nhiều đoạn nếu ngữ cảnh cho phép:

📖 Tổng quan & Bối cảnh: [BẮT BUỘC mở đầu mục này bằng 3 dòng: "Tên truyện: ${storyInfo.title || '(chưa xác định)'}", "Tác giả: ${storyInfo.author || '(chưa xác định)'}", "Thể loại: ${storyInfo.genres?.join(', ') || '(chưa xác định)'}", sau đó mới đến phần mô tả chi tiết bối cảnh/thế giới quan...]
⚔️ Hành trình nhân vật chính: [Mô tả chi tiết...]
⚔️ Hệ thống tu luyện/sức mạnh: [Mô tả chi tiết...]
✅ Điểm mạnh & Đặc sắc: [Mô tả chi tiết...]
📌 Nhận xét & Kết luận: [Mô tả chi tiết...]

LƯU Ý: Giữ nguyên Tên Nhân Vật và Thuật Ngữ chính. Không trả về Markdown code block.

🛑 QUY TẮC BẮT BUỘC VỀ ĐẦU RA: TUYỆT ĐỐI KHÔNG được xuất ra bất kỳ lời dẫn, lời chào, hay câu giao tiếp nào của AI trước hoặc sau bản tóm tắt (ví dụ nghiêm cấm các câu như "Dưới đây là bản tóm tắt...", "Chào bạn, đây là...", "Hy vọng bản tóm tắt này hữu ích..."). Output CHỈ được bắt đầu ngay bằng "📖 Tổng quan & Bối cảnh" và kết thúc ngay sau mục "📌 Nhận xét & Kết luận", không thêm bất kỳ câu nào khác.

[Ngữ cảnh chi tiết]
${mergedContext}`;

    if (engine === 'deepseek') {
        try {
            let text = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", "Bạn là biên tập viên chuyên tóm tắt truyện dài kỳ.", prompt, false);
            text = (text || storyInfo.summary || "").replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
            text = sanitizeAiMathArtifacts(text);
            const overviewIdx = text.indexOf('📖');
            if (overviewIdx > 0) text = text.slice(overviewIdx).trim();
            return text;
        } catch (e) {
            console.warn("DeepSeek failed for refineSummary, giữ nguyên tóm tắt gốc.", e);
            return storyInfo.summary || "";
        }
    }

    const performTask = async (modelId: string) => {
        const response = await getAiClient().models.generateContent({
            model: modelId,
            contents: prompt,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
        });
        let text = response.text || storyInfo.summary || "";
        text = text.replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
        // Fix Gemini Math Mode hallucinations for arrows and markdown chars
        text = sanitizeAiMathArtifacts(text);
        // Defense-in-depth: cắt bỏ mọi câu dẫn/giao tiếp của AI còn sót lại trước khi đến mục "📖 Tổng quan & Bối cảnh"
        const overviewIdx = text.indexOf('📖');
        if (overviewIdx > 0) {
            text = text.slice(overviewIdx).trim();
        }
        return text;
    };

    try {
        return await smartExecution(flashModels, performTask, "Tinh Chỉnh Tóm Tắt Truyện (Flash)", undefined, flashModels[0]);
    } catch (e) {
        console.warn("Flash models failed for refineSummary, falling back to Pro.", e);
        const fallbackModels = ['gemini-3.1-pro-preview'].filter(id => enabledModels?.includes(id) ?? true);
        if (fallbackModels.length === 0) fallbackModels.push('gemini-3.1-pro-preview');
        return await smartExecution(fallbackModels, performTask, "Tinh Chỉnh Tóm Tắt (Pro)", undefined, fallbackModels[0]);
    }
};
