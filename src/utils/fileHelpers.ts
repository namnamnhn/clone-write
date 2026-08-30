// Barrel re-export: fileHelpers.ts trước đây là 1 file ~1140 dòng gộp chung mọi thứ
// (tiện ích cơ bản, parser docx/pdf/epub/zip, tách chương, xuất file). Đã tách thành
// các module nhỏ hơn trong ./file/* để dễ đọc, dễ sửa, dễ khoanh vùng bug hơn.
// Toàn bộ API công khai (tên hàm export) giữ NGUYÊN như cũ nên không cần sửa bất kỳ
// import nào ở nơi khác trong dự án.
export * from './file/core';
export * from './file/parsers';
export * from './file/splitters';
export * from './file/exporters';
