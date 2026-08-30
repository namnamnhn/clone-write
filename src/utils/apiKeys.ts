// SHARED HELPER (đề xuất cải thiện từ fix11/fix12 - trích logic lặp lại ở 3 nơi): kiểm tra 1
// chuỗi API Key có thực sự được cấu hình hay không (khác rỗng sau khi trim). Trước đây
// StartOptionsModal.tsx, ModalManager.tsx (modal "Dịch lại"), và AutomationModal.tsx mỗi nơi tự
// viết lại đúng biểu thức `!!(key && key.trim().length > 0)` - dễ lệch nếu sau này có nơi quên
// cập nhật cùng lúc (ví dụ đổi điều kiện hợp lệ của Key). Dùng chung đúng 1 hàm cho các trường hợp
// "chỉ cần khác rỗng" (DeepSeek trong StartOptionsModal/ModalManager). Lưu ý:
// AutomationModal có thêm 1 điều kiện RIÊNG cho DeepSeek (yêu cầu tối thiểu 10 ký tự,
// `localDsKey.trim().length > 10`) - đây KHÔNG phải cùng 1 logic nên vẫn giữ nguyên tách biệt,
// không gộp vào hàm này.
export const hasApiKey = (key?: string): boolean => !!(key && key.trim().length > 0);
