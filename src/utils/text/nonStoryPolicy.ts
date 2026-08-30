// Một nguồn quy tắc dùng chung cho prompt dịch, AI phân loại file ngắn và hậu kiểm
// Tier 2. Chỉ cho phép dọn lời ngoài truyện thật sự, không biến "lọc rác" thành tóm tắt.

export const SHORT_RAW_FILE_MAX_CHARS = 1200;
export const SHORT_RAW_CLASSIFICATION_BATCH_SIZE = 10;
export const NON_STORY_SKIP_CONFIDENCE = 0.9;

export const EDITORIAL_NOTE_TRANSLATION_POLICY = `
4d. **LỌC LỜI NHẮN BIÊN TẬP NGOÀI TRUYỆN (CHỈ Ở RANH GIỚI ĐẦU/CUỐI CHƯƠNG):**
   - ĐƯỢC PHÉP lược bỏ một dải dòng độc lập nằm sát đầu hoặc sát cuối chương khi các dòng đó rõ ràng chỉ là lời ngoài truyện: tác giả xin nghỉ/thông báo lịch đăng hoặc đổi tên; xin phiếu/nguyệt phiếu/đề cử/ủng hộ; cảm ơn độc giả, quay số/trúng thưởng; quảng bá nhóm/trang/nguồn/đường dẫn; credit converter/dịch giả; lời tâm sự đời tư không mang thông tin về cốt truyện, nhân vật, bối cảnh hay thuật ngữ.
   - Chỉ lược bỏ khi chắc chắn đó là lời biên tập ngoài truyện và nằm thành khối riêng ở RANH GIỚI. KHÔNG quét/xoá theo một từ khoá đơn lẻ ở giữa câu hoặc giữa chương. Nếu phân vân, PHẢI GIỮ VÀ DỊCH.
   - PHẢI GIỮ: mọi tự sự, hội thoại, nội tâm, cảnh truyện, ngoại truyện/phiên ngoại/hậu ký có nội dung; bình luận khán giả/người chơi thuộc cốt truyện; thông báo/bảng hệ thống trong truyện; lời tác giả giải thích thế giới quan, nhân vật, thuật ngữ hoặc tình tiết; chú thích/footnote thật và cú pháp [n]. Việc một dòng có các chữ “tác giả”, “phiếu”, “thông báo”, “nghỉ”, “chúc mừng” không tự biến nó thành rác.
   - Nếu TOÀN BỘ file chỉ là một thông báo ngắn nhưng file vẫn được giao để dịch (ví dụ người dùng chủ động chọn), phải dịch sát nghĩa như mục “Văn bản ngắn”, không tự trả rỗng. Quyền lược bỏ ở đây chỉ áp dụng cho khối lời ngoài truyện đính kèm một chương có nội dung truyện.`;

export const EDITORIAL_NOTE_VALIDATION_POLICY = `
4. LỜI NHẮN BIÊN TẬP NGOÀI TRUYỆN: Bản dịch được phép thiếu một dải dòng độc lập nằm sát ĐẦU hoặc CUỐI chương nếu và chỉ nếu đó rõ ràng là lời ngoài truyện: xin nghỉ/lịch đăng/đổi tên, xin phiếu-nguyệt phiếu-đề cử-ủng hộ, cảm ơn/quay thưởng, quảng bá trang/nguồn/đường dẫn/credit, hoặc tâm sự đời tư không mang thông tin truyện. Không coi phần lược bỏ đúng phạm vi này là thiếu nội dung.
   NGƯỢC LẠI, vẫn phải đối chiếu và bảo vệ mọi tự sự/hội thoại/cảnh truyện; ngoại truyện, phiên ngoại, hậu ký có nội dung; bình luận khán giả/người chơi và thông báo/bảng hệ thống thuộc cốt truyện; lời tác giả giải thích thế giới quan/nhân vật/thuật ngữ/tình tiết; chú thích/footnote thật. Không được suy ra “rác” chỉ vì có một từ như tác giả, phiếu, thông báo, nghỉ hoặc chúc mừng. Nếu mơ hồ, coi đó là nội dung cần giữ. Bản dịch tự thêm lời dẫn/ghi chú không có ở gốc cũng không được mặc nhiên bỏ qua.`;

export const SHORT_FILE_CLASSIFIER_POLICY = `
Chỉ gắn NON_STORY khi TOÀN BỘ file thực chất là một thông báo/lời ngoài truyện độc lập: xin nghỉ hoặc đổi lịch đăng; đổi tên/tên sách; xin phiếu-nguyệt phiếu-đề cử/ủng hộ; cảm ơn độc giả/quay số-trúng thưởng; quảng cáo trang/nhóm/nguồn; credit converter/dịch giả; tâm sự đời tư không chứa diễn biến truyện.
Phải gắn STORY nếu có bất kỳ tự sự, hành động, hội thoại, nội tâm, cảnh truyện, ngoại truyện/phiên ngoại/hậu ký có nội dung, bình luận khán giả/người chơi trong truyện, thông báo/bảng hệ thống trong truyện, giải thích thế giới quan/nhân vật/thuật ngữ/tình tiết hoặc chú thích thật cần xuất bản.
Không phân loại theo từ khoá đơn lẻ. File ngắn, chương kết ngắn, đoạn mở đầu ngắn và văn bản khó hiểu vẫn là STORY. Khi không chắc chắn, trả UNCERTAIN; tuyệt đối không đoán NON_STORY.`;

const FOOTNOTE_DEFINITION_RE = /^\[\^?[^\]\s]+\]\s*[:.-]\s*\S/;

export function isClearlyEditorialNoiseLine(rawLine: string): boolean {
    const line = rawLine.trim();
    if (!line || FOOTNOTE_DEFINITION_RE.test(line) || line.length > 320) return false;
    return (
        /^(?:convert(?:er)?|dịch(?:\s*giả|\s*thuật)?|edit|biên\s*tập|hiệu\s*đính|người\s*dịch|nhóm\s*dịch|team\s*dịch|nguồn|source)\s*(?:by|bởi)?\s*[:\-]/i.test(line) ||
        /^(?:https?:\/\/|www\.)\S+/i.test(line) ||
        /^(?:truyenfull|tangthuvien|metruyenchu|wikidich|uukanshu|qidian|faloo|wattpad|ttv|bachngocsach|truyenyy)\b/i.test(line) ||
        /^(?:cầu|xin)\s*(?:phiếu|nguyệt\s*phiếu|đề\s*cử|donate|ủng\s*hộ|hoa|kẹo|lì\s*xì|theo\s*dõi|đánh\s*giá|bình\s*luận)\b/i.test(line) ||
        /^(?:ủng\s*hộ\s*(?:tác\s*giả|team)|sponsor|patreon|ko-?fi|buymeacoffee|momo|banking|stk|paypal)\b/i.test(line) ||
        /^(?:tác\s*giả|作者|author)\s*[:：\-]?\s*(?:xin\s*nghỉ|nghỉ\s*(?:phép|viết|đăng)|thông\s*báo\s*(?:lịch|nghỉ|đổi)|cầu\s*(?:phiếu|nguyệt\s*phiếu|đề\s*cử)|xin\s*(?:phiếu|nguyệt\s*phiếu|đề\s*cử)|cảm\s*ơn\s*(?:độc\s*giả|mọi\s*người))\b/i.test(line) ||
        /^(?:thông\s*báo|公告|通知)\s*[:：\-]?\s*(?:xin\s*nghỉ|nghỉ\s*(?:phép|đăng)|lịch\s*đăng|đổi\s*(?:tên|lịch)|quay\s*số|trúng\s*thưởng)\b/i.test(line) ||
        /^(?:感谢|求票|求收藏|求月票|请假|停更|休刊)\b/i.test(line) ||
        /^[(（]\s*(?:感谢|求票|求收藏|求月票|请假|停更|休刊)[^)）]*[)）]$/i.test(line)
    );
}

export function fingerprintShortRawContent(text: string): string {
    let hash = 2166136261;
    const normalized = text.replace(/\r\n/g, '\n').trim();
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${normalized.length}:${(hash >>> 0).toString(16)}`;
}
