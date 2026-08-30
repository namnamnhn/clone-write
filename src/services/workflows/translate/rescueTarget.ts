// Helper dùng chung để quyết định "vệ tinh cứu hộ" DeepSeek sẽ đảm nhận 1 lượt thử lại của
// tệp bị nghi vấn vi phạm bộ lọc an toàn / lỗi nội dung / hết Quota Gemini tạm thời, dựa trên
// retryCount hiện tại của tệp đó và API Key DeepSeek đang có.
//
// Quy tắc: nếu có Key DeepSeek, nó đảm nhận `perRescueBudget` lượt cứu hộ -> hết lượt thì
// cách ly (ERROR). Không có Key thì trả về null ngay lập tức.
// (fix44: OpenRouter đã bị loại bỏ hoàn toàn khỏi hệ thống — DeepSeek là vệ tinh duy nhất.)
export type RescueTarget = 'deepseek' | null;

export const getRescueTarget = (
    retryCount: number,
    hasDeepSeek: boolean,
    perRescueBudget: number
): RescueTarget => {
    if (hasDeepSeek && retryCount < perRescueBudget) return 'deepseek';
    return null;
};

// Tổng số lượt cứu hộ khả dụng (dùng để hiển thị "x/y" trong errorMessage).
export const getRescueBudget = (
    hasDeepSeek: boolean,
    perRescueBudget: number
): number => {
    return hasDeepSeek ? perRescueBudget : 0;
};

export const getRescueLabel = (target: RescueTarget): string => {
    if (target === 'deepseek') return 'DeepSeek';
    return '';
};

// ============================================================================
// Đề xuất cải thiện tồn đọng "tách ngân sách cứu hộ theo loại lỗi Safety vs Quota tạm" (từ
// fix15/17/18) — TÁCH TÊN/CẤU TRÚC riêng cho 2 loại lỗi, GIỮ NGUYÊN giá trị số hiện tại
// (không đổi hành vi), để chuẩn bị sẵn chỗ tinh chỉnh độc lập sau này nếu cần mà không phải
// sửa lại 10 vị trí gọi rải rác trong useTranslator.ts/streamTranslate.ts.
//
// - "Safety" (nghi vấn nội dung nhạy cảm / hậu kiểm phát hiện sai lệch): rescue là hướng DI CƯ dài
//   hạn khỏi Gemini cho riêng file đó (Gemini nhiều khả năng sẽ tiếp tục từ chối file này ở các
//   lần thử sau), nên ngân sách giữ nguyên như cũ.
// - "Quota tạm thời" (toàn bộ model Gemini cùng lúc backoff/hết quota, KHÔNG phải nội dung có vấn
//   đề): rescue chỉ là CẦU NỐI NGẮN HẠN để hoàn tất đúng batch đang dở dang, bản chất khác hẳn
//   Safety (file không có vấn đề gì, chỉ đang "mượn tạm" vệ tinh lúc Gemini nghẽn) - có thể cân
//   nhắc ngân sách khác trong tương lai.
export const getSafetyRescueBudgetLimit = (isFixPhase: boolean): number => (isFixPhase ? 1 : 2);
export const getQuotaRescueBudgetLimit = (isFixPhase: boolean): number => (isFixPhase ? 1 : 2);
