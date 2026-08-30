// Hàm thuần (không phụ thuộc hook/state) kiểm tra dự án hiện tại có đang thiếu các thông tin
// bổ trợ mà công cụ AI ở tab "Sửa Lỗi"/"Hán Việt" cần để hoạt động chính xác hay không - dùng
// khi người dùng bấm "Tải File Dịch"/"Import Bản Dịch" trên 2 tab đó (trường hợp thường gặp:
// người dùng đang dịch truyện ở nơi khác, chỉ mở app này để dùng riêng 2 công cụ sửa lỗi/hán
// việt, nên dự án hiện tại còn trống các trường này).
export const getMissingSupportInfoLabels = (
    storyInfo?: { genres?: string[]; contextNotes?: string; additionalRules?: string } | null,
    promptTemplate?: string | null,
    dictionary?: string | null
): string[] => {
    const missing: string[] = [];
    if (!storyInfo?.genres || storyInfo.genres.length === 0) missing.push('Tag truyện (thể loại)');
    if (!storyInfo?.contextNotes || !storyInfo.contextNotes.trim()) missing.push('Ngữ cảnh');
    if (!dictionary || !dictionary.trim()) missing.push('Từ điển');
    if (!promptTemplate || !promptTemplate.trim()) missing.push('Prompt tối ưu');
    if (!storyInfo?.additionalRules || !storyInfo.additionalRules.trim()) missing.push('Quy tắc bổ sung');
    return missing;
};

// Cảnh báo NHẸ (không chặn) - thông tin CÓ tồn tại nhưng có vẻ sơ sài, khác với "thiếu hẳn"
// ở trên (chặn bằng modal). Dùng để nhắc người dùng bổ sung thêm qua toast, không chặn luồng
// import - vì các ngưỡng dưới đây chỉ là gợi ý tương đối, không phải lỗi thực sự.
// Ngưỡng "sơ sài" mặc định - dùng khi không truyền `thresholds` (giữ nguyên hành vi cũ). Người
// dùng có thể tuỳ chỉnh qua Cài đặt (`ruleFixSettings.sparseContextMinLength`/
// `sparseDictMinEntries`/`sparsePromptMinLength`) - đề xuất cải thiện tồn đọng: trước đây các số
// này cố định cứng trong code, không đổi được nếu người dùng thấy quá nhạy/quá lỏng.
const DEFAULT_SPARSE_THRESHOLDS = { minContextLength: 30, minDictEntries: 3, minPromptLength: 200 };

export const getSparseSupportInfoLabels = (
    storyInfo?: { contextNotes?: string } | null,
    promptTemplate?: string | null,
    dictionary?: string | null,
    thresholds?: { minContextLength?: number; minDictEntries?: number; minPromptLength?: number }
): string[] => {
    const t = { ...DEFAULT_SPARSE_THRESHOLDS, ...thresholds };
    const sparse: string[] = [];
    const context = storyInfo?.contextNotes?.trim();
    if (context && context.length > 0 && context.length < t.minContextLength) sparse.push('Ngữ cảnh (quá ngắn)');
    const dict = dictionary?.trim();
    if (dict && dict.length > 0) {
        const entryCount = dict.split('\n').filter(l => l.trim()).length;
        if (entryCount < t.minDictEntries) sparse.push('Từ điển (quá ít mục)');
    }
    const prompt = promptTemplate?.trim();
    if (prompt && prompt.length > 0 && prompt.length < t.minPromptLength) sparse.push('Prompt tối ưu (có vẻ chưa đầy đủ)');
    return sparse;
};
