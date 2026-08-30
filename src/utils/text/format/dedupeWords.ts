// Sửa 2 dạng lỗi thường gặp do AI dịch bị "vấp" khi sinh văn bản (không phải lỗi convert từ
// nguồn, mà lỗi PHÁT SINH trong lúc dịch): (1) lặp nguyên 1 từ liền kề nhau
// ("cấp dưới DƯỚI quyền nó", "quen biết BIẾT bao nhiêu"...), và (2) một số từ bị AI viết sai
// chính tả/dấu theo kiểu lặp lại nhất quán ("uể ỦẢI" thay vì "uể OẢI"). Gộp cả 2 vào 1 file vì
// cùng mục đích: dọn sạch output AI trước khi lưu làm bản dịch cuối, chạy NGAY SAU
// formatBookStyle/fixMergedTitle trong applyBatchResults.ts.

// ----------------------------------------------------------------------------------------------
// 1) LẶP TỪ LIỀN KỀ
// ----------------------------------------------------------------------------------------------
// Tiếng Việt có nhiều từ láy và cụm giao nhau hợp lệ: "từ từ", "tầng tầng lớp lớp", hoặc
// "đả thông thông đạo" ("thông" cuối của động từ + "thông" đầu của danh từ). Vì vậy không
// được xoá mù mọi cặp giống nhau. Chính sách an toàn:
//   1. Cặp lặp đúng 2 lần chỉ sửa khi cả cụm đã được xác nhận là lỗi AI.
//   2. Lặp 3 lần trở lên mới tự thu gọn, trừ từ láy hợp lệ.
// Thà để sót một lỗi nhỏ cho hậu kiểm còn hơn làm sai nghĩa bản dịch.
const VALID_REDUPLICATED_WORDS = new Set<string>([
    'từ', 'xa', 'gần', 'lâu', 'thường', 'vừa', 'đời', 'mãi', 'dần', 'người', 'nhà', 'ngày',
    'năm', 'đêm', 'chốc', 'thoáng', 'hay', 'ầm', 'rào', 'ào', 'ù', 'vù', 'rưng', 'run', 'đều',
    'chăm', 'khăng', 'chằm', 'đau', 'nơi', 'chỗ', 'đứa', 'con', 'cái', 'từng', 'mỗi', 'nào',
    'ai', 'đâu', 'sao', 'gì', 'chi', 'nhau', 'là', 'càng', 'thoi', 'phần', 'nhè', 'khe', 'sẽ',
]);

const CONFIRMED_DUPLICATE_FIXES: { wrong: string; right: string }[] = [
    { wrong: 'cấp dưới dưới quyền', right: 'cấp dưới quyền' },
    { wrong: 'quen biết biết bao nhiêu', right: 'quen biết bao nhiêu' },
    { wrong: 'ngả nghiêng ngả ngả', right: 'ngả nghiêng ngả' },
    { wrong: 'biến mất mất thôi', right: 'biến mất thôi' },
    { wrong: 'đồ ăn ăn được', right: 'đồ ăn được' },
    { wrong: 'hơn cả cả nhà', right: 'hơn cả nhà' },
    { wrong: 'quan quan bao che', right: 'quan bao che' },
    { wrong: 'phụ cấp cấp quốc gia', right: 'phụ cấp quốc gia' },
    { wrong: 'cháu cháu dâu', right: 'cháu dâu' },
    { wrong: 'thèm thèm thuồng', right: 'thèm thuồng' },
    { wrong: 'không yên yên', right: 'không yên' },
];

const buildConfirmedDuplicateRegex = (wrong: string): RegExp => {
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=[^\\p{L}\\p{N}_]|$)`, 'giu');
};

const preserveInitialCase = (replacement: string, matched: string): string => {
    const first = matched.charAt(0);
    return first && first === first.toLocaleUpperCase('vi')
        ? replacement.charAt(0).toLocaleUpperCase('vi') + replacement.slice(1)
        : replacement;
};

/**
 * Sửa cụm lặp đôi đã xác nhận và thu gọn lượt lặp từ 3 lần trở lên (không phân biệt
 * hoa/thường, giữ nguyên dạng xuất hiện lần đầu) — trừ từ láy hợp lệ ở trên.
 * VD: "cấp dưới dưới quyền" -> "cấp dưới quyền"; "quan quan bao che" -> "quan bao che";
 *     nhưng "đi từ từ thôi" -> giữ nguyên (từ láy hợp lệ).
 *
 * LƯU Ý KỸ THUẬT: cố tình KHÔNG dùng \b để đánh dấu biên từ — \b trong JS regex chỉ nhận diện
 * [A-Za-z0-9_] là "word char", chữ Việt có dấu (ề, ó, ư...) bị coi là KHÔNG PHẢI word char, nên
 * \b tạo ranh giới ảo ngay GIỮA 1 từ có dấu (vd giữa "n" và "ó" trong "nó"), làm regex khớp nhầm
 * xuyên qua ranh giới 2 từ khác nhau ("...quyền nó" từng bị ăn nhầm thành "...quyềnó" khi test).
 * Dùng đúng kiểu biên `(^|[^\p{L}\p{N}_])` / lookahead `(?=[^\p{L}\p{N}_]|$)` đã dùng ở
 * `buildRuleRegex` (ruleFixing.ts) — an toàn với mọi ký tự Unicode chữ Việt.
 */
export const collapseDuplicateWords = (text: string): string => {
    if (!text) return text;
    const genericRegex = /(^|[^\p{L}\p{N}_])(\p{L}+)(?:[ \t]+\2){2,}(?=[^\p{L}\p{N}_]|$)/giu;
    let result = text.replace(genericRegex, (match: string, prefix: string, word: string) => {
        if (VALID_REDUPLICATED_WORDS.has(word.toLowerCase())) return match;
        return prefix + word;
    });

    // Chạy mẫu xác nhận SAU bước 3+ để "quan quan quan bao che" không bị mẫu con
    // "quan quan bao che" ăn mất hai từ cuối rồi để sót lại một cặp.
    for (const { wrong, right } of CONFIRMED_DUPLICATE_FIXES) {
        result = result.replace(
            buildConfirmedDuplicateRegex(wrong),
            (_match: string, prefix: string, matched: string) => prefix + preserveInitialCase(right, matched),
        );
    }
    return result;
};

// ----------------------------------------------------------------------------------------------
// 2) LỖI CHÍNH TẢ LẶP LẠI CÓ QUY LUẬT (do AI hay viết sai 1 kiểu, nhiều chương khác nhau)
// ----------------------------------------------------------------------------------------------
// Khác lỗi convert nguồn (đã có ruleFixing.ts cho người dùng tự nhập Sai->Đúng theo từng
// truyện) — đây là danh sách CỐ ĐỊNH, ÁP DỤNG SẴN cho MỌI truyện vì đã xác nhận là lỗi
// chính tả AI hay mắc (không phải văn phong/tuỳ truyện). Chỉ thêm từ vào đây khi đã xác nhận
// chắc chắn "wrong" không phải là 1 từ đúng khác trong tiếng Việt (tránh sửa nhầm).
const KNOWN_TYPO_FIXES: { wrong: string; right: string }[] = [
    { wrong: 'uể ủai', right: 'uể oải' },
];

const buildTypoRegex = (wrong: string): RegExp => {
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=[^\\p{L}\\p{N}_]|$)`, 'giu');
};

export const fixKnownTypos = (text: string): string => {
    if (!text) return text;
    let result = text;
    for (const { wrong, right } of KNOWN_TYPO_FIXES) {
        result = result.replace(buildTypoRegex(wrong), (_m, prefix) => prefix + right);
    }
    return result;
};

/** Gộp cả 2 bước, gọi 1 lần duy nhất trong pipeline dịch. */
export const cleanupAiTextArtifacts = (text: string): string => {
    if (!text) return text;
    return fixKnownTypos(collapseDuplicateWords(text));
};
