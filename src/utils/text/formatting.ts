// Barrel re-export: formatting.ts trước đây là 1 file ~600 dòng gộp chung 5 hàm không
// liên quan trực tiếp tới nhau (title case, ghép/tách đoạn văn, format sách, sửa tiêu đề
// dính liền). Đã tách thành các file nhỏ hơn trong ./format/* để dễ định vị khi cần sửa
// một loại lỗi format cụ thể. API công khai giữ NGUYÊN nên không cần sửa import ở nơi khác.
export * from './format/textCase';
export * from './format/paragraphs';
export * from './format/bookStyle';
export * from './format/titleMergeFixer';
export * from './format/dedupeWords';
