// Nhóm hàm: SO SÁNH ĐỘ GIỐNG NHAU giữa 2 đoạn văn bản — dùng để phát hiện "trùng gần đúng"
// (near-duplicate) khi 2 chương là cùng 1 nội dung nhưng bị đổi vài từ / bị cắt bớt, nên
// không khớp tuyệt đối ký tự-với-ký tự (xem thêm handleRemoveDuplicates trong fileCleanup.ts,
// vốn chỉ bắt được trùng khớp 100%).
//
// Dùng hệ số Dice/Sørensen trên các cặp ký tự liền kề (character bigram) thay vì so từng từ:
// văn bản Trung/Việt không có khoảng trắng tách từ rõ ràng như tiếng Anh, nên bigram theo
// ký tự vừa nhanh vừa không cần tách từ, và vẫn chịu được việc đổi vài từ giữa 2 bản (chỉ
// các bigram ngay tại chỗ đổi bị lệch, phần còn lại của câu vẫn khớp).

const buildBigramCounts = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
        const bg = s.substring(i, i + 2);
        map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
};

const diceFromCounts = (bigramsA: Map<string, number>, lenA: number, bigramsB: Map<string, number>, lenB: number): number => {
    if (lenA < 2 || lenB < 2) return 0;
    let intersection = 0;
    bigramsA.forEach((countA, bg) => {
        const countB = bigramsB.get(bg);
        if (countB) intersection += Math.min(countA, countB);
    });
    const totalA = lenA - 1;
    const totalB = lenB - 1;
    if (totalA + totalB === 0) return 0;
    return (2 * intersection) / (totalA + totalB);
};

// Export riêng buildBigramCounts + diceFromCounts (thay vì chỉ diceSimilarity(a,b)) để nơi nào
// cần so 1 chuỗi với NHIỀU chuỗi khác (ví dụ quét trùng gần đúng cho cả nghìn chương) có thể
// dựng bigram-map cho mỗi chuỗi ĐÚNG 1 LẦN rồi tái sử dụng, thay vì build lại từ đầu ở mỗi lần
// so sánh — với vài nghìn chương, việc build lại lặp lại này chậm hơn đáng kể.
export { buildBigramCounts, diceFromCounts };

/**
 * Trả về hệ số giống nhau Dice/Sørensen trong khoảng [0, 1] giữa 2 chuỗi.
 * 0 = hoàn toàn khác nhau, 1 = giống hệt nhau.
 * Tiện dùng cho so sánh 1-lần-1-cặp; nếu cần so 1 chuỗi với nhiều chuỗi khác, dùng
 * buildBigramCounts + diceFromCounts để tránh build lại bigram-map nhiều lần.
 */
export const diceSimilarity = (a: string, b: string): number => {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    return diceFromCounts(buildBigramCounts(a), a.length, buildBigramCounts(b), b.length);
};
