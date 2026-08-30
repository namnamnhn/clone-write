import { RatioLimits } from '../types';

// NGUỒN DUY NHẤT (single source of truth) cho ngưỡng tỉ lệ ký tự Gốc/Dịch mặc định.
// Trước đây các con số này bị lặp lại rải rác ở nhiều nơi (Header.tsx, useCoreState.ts,
// App.tsx, validation.ts...) — mỗi lần cần đổi 1 giá trị (ví dụ max Trung 4.4 -> 6.2)
// phải nhớ tìm & sửa đúng hết mọi chỗ, rất dễ sót. Giờ chỉ cần sửa DUY NHẤT ở đây,
// các nơi khác import và dùng lại object này.
export const DEFAULT_RATIO_LIMITS: RatioLimits = {
  vn: { min: 0.7, max: 1.4 },   // Việt / Convert
  en: { min: 0.7, max: 1.4 },   // Anh / Phương Tây
  krjp: { min: 0.7, max: 3.5 }, // Hàn / Nhật
  cn: { min: 2, max: 6.2 },     // Trung (Raw)
};
