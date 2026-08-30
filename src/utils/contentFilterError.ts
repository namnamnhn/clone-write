// Helper dùng CHUNG cho code MỚI khi cần nhận diện/mô tả lỗi bị chặn bởi bộ lọc nội dung của
// Gemini (đề xuất cải thiện tồn đọng "gộp isContentFilterError dùng chung").
//
// LƯU Ý QUAN TRỌNG: file này KHÔNG thay thế các đoạn dò chuỗi lỗi hiện có rải rác ở
// useTranslator.ts, gemini.ts, repair.ts, smartFixCore.ts, contentSafety.ts, context.ts,
// names.ts, autoAnalyze.ts (khảo sát fix13 cho thấy có 10+ vị trí, mỗi nơi dò 1 tập từ khoá hơi
// khác nhau tuỳ ngữ cảnh) — gộp lại TOÀN BỘ các nơi đó rủi ro cao hơn ước tính ban đầu, cần 1
// phiên riêng đọc kỹ từng nơi để không làm lệch hành vi cứu hộ hiện tại. File này chỉ dùng cho
// code MỚI viết từ fix này trở đi, tránh phát sinh thêm nơi dò chuỗi trùng lặp mới.
export const CONTENT_FILTER_FINISH_REASONS = ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'OTHER', 'RECITATION', 'SPII'] as const;
export type ContentFilterFinishReason = typeof CONTENT_FILTER_FINISH_REASONS[number];

export const isContentFilterFinishReason = (fr: unknown): fr is ContentFilterFinishReason =>
    typeof fr === 'string' && (CONTENT_FILTER_FINISH_REASONS as readonly string[]).includes(fr);

// SAFETY/BLOCKLIST/PROHIBITED_CONTENT: AI thực sự đánh giá nội dung nhạy cảm.
// OTHER/RECITATION/SPII: thường là lý do KỸ THUẬT (trùng dữ liệu huấn luyện, lỗi phân loại nội
// bộ...), không hẳn do nội dung thật sự nguy hiểm.
export const isSubstantiveContentFilterReason = (fr: ContentFilterFinishReason): boolean =>
    fr === 'SAFETY' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT';

/**
 * Dựng message lỗi thống nhất cho 1 candidate/chunk bị bộ lọc nội dung chặn. GIỮ NGUYÊN cụm khoá
 * "Safety/Blocklist" ở đầu message để tương thích với các nơi đang dò chuỗi hiện có trong hệ
 * thống (isSafetyError ở useTranslator.ts/gemini.ts/repair.ts/smartFixCore.ts).
 */
export const buildContentFilterErrorMessage = (modelId: string, fr: ContentFilterFinishReason): string => {
    const kindLabel = isSubstantiveContentFilterReason(fr)
        ? 'nội dung nhạy cảm thật sự'
        : 'lý do kỹ thuật của bộ lọc (không hẳn do nội dung nguy hiểm)';
    return `⚠️ Model ${modelId} báo lỗi vi phạm chính sách nội dung (Safety/Blocklist) - có vẻ do ${kindLabel}. Trả về lỗi ngay để chia nhỏ batch... Finish Reason: ${fr}`;
};
