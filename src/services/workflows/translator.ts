// Barrel re-export: translator.ts trước đây là 1 file ~1520 dòng gộp chung 8 hàm nghiệp vụ
// khác nhau (sửa lỗi hàng loạt, tạo tiêu đề, kiểm tra an toàn nội dung, và đặc biệt là hàm lõi
// translateBatchStream ~840 dòng). Đã tách thành các module nhỏ hơn trong ./translate/* theo
// đúng dependency thực tế giữa chúng (repair.ts không phụ thuộc gì, streamTranslate.ts phụ
// thuộc aiValidation.ts + repair.ts...). CHỈ di chuyển vị trí code, KHÔNG sửa bất kỳ logic nào
// bên trong từng hàm — rủi ro thay đổi hành vi gần như bằng 0.
//
// API công khai (tên hàm export) giữ NGUYÊN như cũ nên không cần sửa import ở nơi khác.
export * from './translate/repair';
export * from './translate/titleBatch';
export * from './translate/aiValidation';
export * from './translate/streamTranslate';
export * from './translate/smartFixChunk';
export * from './translate/contentSafety';
