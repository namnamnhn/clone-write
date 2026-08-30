// Barrel re-export: analyzer.ts trước đây là 1 file ~873 dòng gộp chung 13 hàm nghiệp vụ
// khác nhau (phân tích ngữ cảnh, prompt/quy tắc, tên nhân vật, ảnh bìa, quy trình tự động
// phân tích truyện, phân tích lỗi tuỳ chỉnh). Đã tách thành các module nhỏ hơn trong
// ./analyze/* theo nhóm chức năng thực tế. CHỈ di chuyển vị trí code, KHÔNG sửa logic bên
// trong từng hàm.
//
// API công khai (tên hàm export) giữ NGUYÊN như cũ nên không cần sửa import ở nơi khác.
export * from './analyze/context';
export * from './analyze/promptRules';
export * from './analyze/names';
export * from './analyze/cover';
export * from './analyze/autoAnalyze';
export * from './analyze/customError';
