// Chuẩn hóa chữ hoa/thường đầu từ (Title Case) — dùng cho tiêu đề chương.
export const toTitleCase = (str: string): string => {
  return str.replace(
    /([\p{L}0-9_]+)(\S*)/gu,
    (match, p1, p2) =>
      p1.charAt(0).toUpperCase() + p1.slice(1).toLowerCase() + p2,
  );
};
