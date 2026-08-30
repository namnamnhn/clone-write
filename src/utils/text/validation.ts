import { RatioLimits } from '../../types';
import { REGEX_PATTERNS, JUNK_SITE_NAMES } from '../../utils/regexPatterns';
import { DEFAULT_RATIO_LIMITS } from '../../constants/ratioLimits';
import { isClearlyEditorialNoiseLine } from './nonStoryPolicy';

export const isVietnameseContent = (text: string): boolean => {
    if (!text || text.length < 50) return false;
    const sample = text.substring(0, 2000).toLowerCase();
    
    const cnCount = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (cnCount > sample.length * 0.1) return false;

    const accentMatches = sample.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g);
    if ((accentMatches?.length || 0) > 5) return true;
    const viMatches = sample.match(/\b(của|là|và|những|được|người|trong|một|không|có|anh|hắn|cô|nàng)\b/g);
    return (viMatches?.length || 0) > 3; 
};

export const isEnglishContent = (text: string): boolean => {
    if (!text || text.length < 50) return false;
    const sample = text.substring(0, 1000).toLowerCase();
    const enMatches = sample.match(/\b(the|and|is|that|with|from|have|this|are|was|for|not|but|you|they|he|she)\b/g);
    const enCount = enMatches ? enMatches.length : 0;
    if (isVietnameseContent(sample)) return false;
    const viMatches = sample.match(/\b(là|và|của|những|được|trong|with|người|khi|đã|đang|sẽ|này|đó|như|còn)\b/g);
    const viCount = viMatches ? viMatches.length : 0;
    return enCount > (viCount * 2) && enCount > 5;
};

// Vietnamese words that commonly start a real narrative clause. If one of these
// appears right after a suspected translator name, we treat it as the start of
// the real content rather than swallowing it into the name.
const CREDIT_SENTENCE_STARTERS = new Set([
    'sau', 'ngay', 'khi', 'một', 'này', 'trong', 'tại', 'trên', 'dưới', 'bỗng', 'đột',
    'nàng', 'hắn', 'anh', 'cô', 'y', 'thị', 'lúc', 'vừa', 'đang', 'sáng', 'đêm', 'ngày',
    'chương', 'hồi', 'quyển', 'tiếp', 'bên', 'giữa', 'từ', 'nơi', 'nếu', 'khắp'
]);

// Matches a translator-credit label at the start of a line, e.g.
// "Dịch giả:", "Dịch & Đề tự:", "Dịch và Đề tự:", "Convert:", "Edit:"
const TRANSLATOR_CREDIT_LABEL_RE = /^(?:dịch\s*(?:&|và)\s*đề\s*tự|dịch\s*giả|dịch\s*thuật|biên\s*tập|convert|edit|dịch)\s*[:\-]?\s*/i;

/**
 * Some raw/convert sources glue the translator credit line directly onto the
 * real opening sentence of the chapter with no separating line break, e.g.
 * "Dịch giả: Cà Rốt Tảng đá nứt ra, hiện một người cao to...".
 * Blanking the whole line (the old behaviour) deletes real chapter content,
 * which later trips false-positive hallucination checks in AI Tier 2
 * (the [GỐC ĐẦU] excerpt loses content that [DỊCH ĐẦU] still has).
 *
 * This tries to cut ONLY the label + translator name (+ an optional repeated
 * "thơ đề tự của <name>" style credit clause), returning just the real content
 * that follows. Returns null if the line doesn't look like a credit line, or if
 * no plausible translator name could be isolated (caller should fall back to
 * its previous behaviour in that case).
 */
export function stripTranslatorCredit(line: string): string | null {
    const labelMatch = line.match(TRANSLATOR_CREDIT_LABEL_RE);
    if (!labelMatch) return null;

    const rest = line.slice(labelMatch[0].length);
    const words = rest.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;

    // Translator pen-names on these sites are almost always 1-2 words
    // (e.g. "Cà Rốt", "Gió", "Mèo Béo"). Cap at 2 so we don't swallow the
    // start of a real sentence that also happens to be capitalized.
    let nameWordCount = 0;
    for (let i = 0; i < Math.min(2, words.length); i++) {
        const w = words[i];
        if (/^[A-ZÀ-Ỹ][a-zà-ỹ]*$/.test(w) && !CREDIT_SENTENCE_STARTERS.has(w.toLowerCase())) {
            nameWordCount = i + 1;
        } else {
            break;
        }
    }
    if (nameWordCount === 0) return null;

    const name = words.slice(0, nameWordCount).join(' ');
    let consumedWords = nameWordCount;

    // Handle a repeated self-credit clause right after the name, e.g.
    // "thơ đề tự của Cà Rốt" / "đề tự của Cà Rốt"
    const remainder = words.slice(consumedWords).join(' ');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatRe = new RegExp(`^(?:thơ\\s+)?đề\\s*tự\\s*(?:của\\s+)?${escapedName}\\s*`, 'i');
    const repeatMatch = remainder.match(repeatRe);
    if (repeatMatch) {
        consumedWords += repeatMatch[0].trim().split(/\s+/).length;
    }

    const realContent = words.slice(consumedWords).join(' ').trim();
    return realContent; // may be '' if the whole line really was just credit
}

// A bare JUNK_KEYWORDS hit anywhere in a line is NOT safe to treat as junk on its own —
// several entries in that list (tác giả, phiếu, chúc mừng, nghỉ ngơi...) are everyday
// Vietnamese vocabulary that shows up constantly in ordinary narration/dialogue: a
// character resting ("quyết định nghỉ ngơi"), someone congratulating another on a
// breakthrough ("chúc mừng ngươi đã đột phá" — extremely common in cultivation novels), an
// in-story game/system "voucher" item ("phiếu triệu hồi"), a character who happens to be
// an author. Matching these anywhere in a long narrative sentence was silently chopping
// off real chapter endings before the AI Tier 2 comparison ever saw them, making a fully
// correct translation look "lệch nội dung" against a source excerpt that had lost its
// real tail.
//
// FIX (sai tỷ lệ / ratio bị thổi phồng hàng nghìn %): "line.length < 60 => coi là rác"
// là quá lỏng lẻo — RẤT nhiều câu thoại/câu văn bình thường trong truyện dài dưới 60 ký
// tự và tình cờ chứa 1 trong các từ cực kỳ thông dụng ở trên (vd: "\"Ngươi tưởng ta sẽ
// nghỉ ngơi sao?\"", "\"Chúc mừng ngươi đã đột phá!\""). Với luật cũ, các câu này bị nhận
// diện nhầm là rác, kích hoạt phần cắt-đuôi bên dưới cắt bỏ gần như toàn bộ nội dung thật
// còn lại của chương, khiến source sau khi chuẩn hoá co lại chỉ còn vài chục ký tự trong
// khi target vẫn giữ nguyên độ dài => ratio% bị thổi phồng phi lý (vài nghìn %).
//
// Chỉ tin một cú khớp từ khoá "trần trụi" (không nằm trong các mẫu label rõ ràng ở trên)
// khi nó thực sự đọc như một dòng thông báo/nhãn độc lập: từ khoá phải nằm ngay đầu dòng
// (cho phép vài ký tự mở ngoặc/khoảng trắng phía trước), giống "Tác giả:", "Nghỉ ngơi 3
// ngày —" — không còn coi MỌI dòng ngắn là rác nữa.
function isLikelyJunkKeywordLine(line: string): boolean {
    const match = line.match(REGEX_PATTERNS.JUNK_KEYWORDS);
    if (!match) return false;
    return (match.index ?? 999) < 15;
}

export function removeJunkForValidation(text: string): string {
    const lines = text.split('\n');
    if (lines.length < 3) return text;
    
    // 1. Strip tail junk
    // FIX (sai tỷ lệ / ratio bị thổi phồng hàng nghìn %): logic cũ quét XUÔI từ đầu cửa
    // sổ 50 dòng cuối và hễ gặp dòng "rác" ĐẦU TIÊN trong cửa sổ đó là cắt bỏ toàn bộ phần
    // còn lại — kể cả khi dòng đó chỉ là một câu thoại/câu văn bình thường nằm giữa chương
    // (false positive), không phải rác thật ở cuối chương. Hậu quả: hàng chục dòng nội
    // dung THẬT bị cắt bỏ khỏi source khi chuẩn hoá cho ratio check, làm mẫu số co lại bất
    // thường trong khi target giữ nguyên => ratio% bị thổi phồng phi lý.
    //
    // Sửa: quét NGƯỢC từ dòng cuối cùng lên, chỉ cắt một dải LIÊN TỤC các dòng rác/dòng
    // trống thực sự chạm vào cuối văn bản (đúng bản chất của rác cuối chương: banner/quảng
    // cáo/ghi chú luôn nằm sát cuối). Gặp dòng nội dung thật đầu tiên là dừng lại ngay,
    // không đụng tới phần trước đó nữa.
    let chopIndex = lines.length;
    const minIndex = Math.max(0, lines.length - 50);

    const isTailJunkLine = (line: string): boolean => isClearlyEditorialNoiseLine(line);

    for (let i = lines.length - 1; i >= minIndex; i--) {
        const line = lines[i].trim();

        if (line === '' || line === '-' || line === '---' || line === '***') {
            chopIndex = i;
            continue; // trailing blank/separator lines: keep scanning backward
        }

        if (isTailJunkLine(line)) {
            chopIndex = i;
            continue; // part of the contiguous junk run touching the end: keep going
        }

        break; // hit real content — stop, don't touch anything before this
    }
    
    // 2. Filter out junk lines near the head (up to 15 lines). Walks forward from line 0
    // and blanks a CONTIGUOUS run of junk/blank lines at the very start, stopping at the
    // first real narrative line. Previously this only checked a narrow fixed-prefix list
    // (bonus/event/donate/converter/nguồn/nhóm dịch/edit/dịch + known site names), far
    // narrower than the tail check above — so free-form ads/tâm sự tác giả/chú giải at
    // the HEAD routinely slipped through uncleaned into the AI Tier 2 comparison window
    // ([GỐC ĐẦU]), making a fully-correct translation look "lệch nội dung" simply because
    // the AI was comparing the clean translation against a still-dirty source excerpt.
    // Now reuses the same broad JUNK_KEYWORDS test as the tail (step 1 above), capped to
    // short-ish lines only, so real narrative sentences that merely mention one of these
    // words in passing aren't mistakenly wiped out.
    for (let i = 0; i < Math.min(15, chopIndex); i++) {
        const line = lines[i].trim();
        if (line === '' || line === '-' || line === '---' || line === '***') continue;

        const lowerLine = line.toLowerCase();
        const isJunkLine =
            /^(?:bonus|event|donate|converter|nguồn|nhóm dịch|edit|dịch)/i.test(line) ||
            line === '"Đòi"' || line === 'Đấu Phá' ||
            JUNK_SITE_NAMES.some(site => lowerLine.includes(site.toLowerCase())) ||
            isClearlyEditorialNoiseLine(line);

        if (!isJunkLine) break; // real narrative content starts here — stop scanning

        // Some raw/convert sources glue the real opening sentence of the
        // chapter directly onto the translator-credit line (no line break).
        // Try to keep that real content instead of blanking the whole line,
        // otherwise AI Tier 2 sees a truncated [GỐC ĐẦU] and false-flags the
        // translation as having "invented" content (HALLUCINATION_PERSIST).
        const strippedContent = stripTranslatorCredit(line);
        const remaining = strippedContent || '';
        lines[i] = remaining;
        if (remaining.trim() !== '') break; // real content glued on — keep it, stop here
    }
    
    return lines.slice(0, chopIndex).filter(l => l !== '').join('\n');
}

export function normalizeForRatioCheck(text: string): string {
    const cleanText = removeJunkForValidation(text);
    return cleanText
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function detectFragmentationMultiplier(sourceText: string): number {
    const lines = sourceText.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 5) return 1.0;
    const contentLines = lines.filter(l => l.trim().length > 3);
    if (contentLines.length === 0) return 1.0;
    const avgLineLen = contentLines.reduce((sum, l) => sum + l.trim().length, 0) / contentLines.length;
    
    // Calculate ratio of lines that don't end with typical sentence-ending punctuation
    const linesWithoutEndingPunct = contentLines.filter(l => !/[.!?…\"'»\])]\s*$/.test(l.trim())).length;
    const noPunctuationRatio = linesWithoutEndingPunct / contentLines.length;

    // A typical fragmented PDF or convert file will have average line length < 80 
    // and a high number of lines that don't end in punctuation.
    if (avgLineLen < 25 && noPunctuationRatio > 0.4) return 1.4;
    if (avgLineLen < 45 && noPunctuationRatio > 0.3) return 1.25;
    if (avgLineLen < 80 && noPunctuationRatio > 0.3) return 1.15; // Typical PDF line wrapping
    
    return 1.0;
}

// FIX (báo oan chương giải thích/chú thích THẬT của tác giả): trước đây dùng .test() thô trên
// toàn bộ title/500 ký tự đầu — cùng lỗi "bare keyword" đã ghi chú ở isLikelyJunkKeywordLine phía
// trên (tác giả/phiếu/chúc mừng/nghỉ ngơi... là từ vựng thường ngày), nhưng KHÔNG có điều kiện vị
// trí nào để giảm rủi ro, nên một chương ngắn là "Lời tác giả: giải thích về thế giới quan/thuật
// ngữ trong truyện..." (nội dung THẬT cần giữ, không phải rác) bị chấm là rác oan chỉ vì có chữ
// "tác giả" xuất hiện đâu đó trong 500 ký tự đầu. Xét theo TỪNG DÒNG (giống isLikelyJunkKeywordLine
// ở trên) và chỉ tính là rác khi từ khoá nằm sát đầu MỘT dòng cụ thể — đọc như một NHÃN mở đầu độc
// lập (VD "Thông báo:", "Tác giả:", "Xin nghỉ phép 3 ngày —"), không phải khi nó nằm giữa một câu
// giải thích dài về nội dung truyện hay xuất hiện ở dòng thứ 2-3 sau tiêu đề chương.
function hasLeadingJunkKeywordLine(text: string): boolean {
    return text.split('\n').some(line => isLikelyJunkKeywordLine(line.trim()));
}

export const detectJunkChapter = (title: string, content: string): boolean => {
    const len = content.length;
    if (len < 1200 && isLikelyJunkKeywordLine(title.trim())) return true;
    const sample = content.substring(0, 500);
    if (len < 2000 && hasLeadingJunkKeywordLine(sample)) return true;
    return false;
};

const computeSimpleHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
};

const detectLangCache = new Map<string, string>();
const detectLangFast = (sample: string, metaLang: string, isLatinContent: boolean, cnDensity: number, jpDensity: number, krDensity: number) => {
    const sampleHash = sample.length > 500 ? computeSimpleHash(sample.substring(0, 500)) : sample;
    const key = `${sampleHash}_${metaLang}`;
    if (detectLangCache.has(key)) return detectLangCache.get(key)!;
    let detectedLang = 'vn';
    if (isLatinContent) {
        if (isEnglishContent(sample)) {
            detectedLang = 'en';
        } else {
            detectedLang = 'vn';
        }
    } else {
        if (metaLang.includes('trung') || metaLang.includes('chinese')) {
            detectedLang = 'cn';
        } else if (metaLang.includes('nhật') || metaLang.includes('japan') || metaLang.includes('hàn') || metaLang.includes('korea')) {
            detectedLang = 'krjp';
        } else if (metaLang.includes('anh') || metaLang.includes('english')) {
            detectedLang = 'en';
        } else if (metaLang.includes('convert')) {
            detectedLang = 'vn';
        } else {
            if (cnDensity > 0.15) {
                detectedLang = 'cn'; 
            } else if (jpDensity > 0.05 || (jpDensity > 0.01 && cnDensity > 0.05)) {
                detectedLang = 'krjp'; 
            } else if (krDensity > 0.05) {
                detectedLang = 'krjp'; 
            } else if (isEnglishContent(sample)) {
                detectedLang = 'en'; 
            }
        }
    }
    detectLangCache.set(key, detectedLang);
    if (detectLangCache.size > 2000) detectLangCache.delete(detectLangCache.keys().next().value);
    return detectedLang;
}

export const validateTranslationIntegrity = (source: string, target: string, limits?: RatioLimits, sourceLanguages?: string | string[], usedModel?: string): { isValid: boolean; reason?: string; ratio: number; isFragmentedSource?: boolean } => {
    if (!source || !target) return { isValid: false, reason: "Nội dung rỗng", ratio: 0 };
    
    const normSource = normalizeForRatioCheck(source);
    const normTarget = normalizeForRatioCheck(target);
    const srcLen = normSource.length;
    const tgtLen = normTarget.length;

    const ratio = tgtLen / Math.max(1, srcLen);

    if (source.length < 500) return { isValid: true, ratio };
    
    // Bỏ qua kiểm tra tính toàn vẹn (tỷ lệ/rác) nếu dùng model thủ công (người dùng tự chịu trách nhiệm)
    if (usedModel === 'Thủ công') {
        return { isValid: true, ratio };
    }
    
    // Detect fragmented source
    const fragmentMultiplier = detectFragmentationMultiplier(source);
    const isFragmentedSource = fragmentMultiplier > 1.05;

    const sample = source.substring(0, 3000); 
    const cnMatches = sample.match(/[\u4e00-\u9fa5]/g) || [];
    const jpMatches = sample.match(/[\u3040-\u30ff]/g) || []; 
    const krMatches = sample.match(/[\uac00-\ud7af]/g) || []; 
    
    const totalSampleLen = Math.max(1, sample.length);
    const cnDensity = cnMatches.length / totalSampleLen;
    const jpDensity = jpMatches.length / totalSampleLen;
    const krDensity = krMatches.length / totalSampleLen;

    let detectedLang = 'vn';
    const isLatinContent = cnDensity < 0.05 && jpDensity < 0.01 && krDensity < 0.01;

    let langs = [];
    if (sourceLanguages) {
        if (Array.isArray(sourceLanguages)) langs = sourceLanguages;
        else langs = [sourceLanguages];
    }
    const metaLang = langs.map(l => l.toLowerCase()).join(' ');

    if (langs.length === 1 && metaLang.length > 0) {
        detectedLang = detectLangFast(sample, metaLang, isLatinContent, cnDensity, jpDensity, krDensity);
    } else {
        // Dynamic detection if multiple or zero languages are selected
        detectedLang = detectLangFast(sample, '', isLatinContent, cnDensity, jpDensity, krDensity);
    }

    let min = 0.7, max = 1.4;

    // FIX (crash "z.toFixed is not a function"): trước đây dùng `limits.cn?.max ?? DEFAULT...`,
    // nhưng nếu limits.cn.max bị lưu thành chuỗi rỗng '' (không phải null/undefined, ví dụ do
    // UI ghi tạm giá trị dở dang khi người dùng đang gõ số thập phân), toán tử ?? KHÔNG thay
    // thế nó bằng giá trị mặc định, khiến biến max mang giá trị '' rồi crash khi gọi .toFixed().
    // numOr() coi mọi giá trị không phải number hữu hạn (kể cả '', NaN, null, undefined) là
    // không hợp lệ và luôn trả về fallback, đảm bảo min/max luôn là number thật.
    const numOr = (v: any, fallback: number): number => (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

    if (limits) {
        switch (detectedLang) {
            case 'cn': min = numOr(limits.cn?.min, DEFAULT_RATIO_LIMITS.cn.min); max = numOr(limits.cn?.max, DEFAULT_RATIO_LIMITS.cn.max); break;
            case 'krjp': min = numOr(limits.krjp?.min, DEFAULT_RATIO_LIMITS.krjp.min); max = numOr(limits.krjp?.max, DEFAULT_RATIO_LIMITS.krjp.max); break;
            case 'en': min = numOr(limits.en?.min, DEFAULT_RATIO_LIMITS.en.min); max = numOr(limits.en?.max, DEFAULT_RATIO_LIMITS.en.max); break;
            case 'vn': min = numOr(limits.vn?.min, DEFAULT_RATIO_LIMITS.vn.min); max = numOr(limits.vn?.max, DEFAULT_RATIO_LIMITS.vn.max); break;
        }
    } else {
        switch (detectedLang) {
            case 'cn': min = DEFAULT_RATIO_LIMITS.cn.min; max = DEFAULT_RATIO_LIMITS.cn.max; break;
            case 'krjp': min = DEFAULT_RATIO_LIMITS.krjp.min; max = DEFAULT_RATIO_LIMITS.krjp.max; break;
            case 'en': min = DEFAULT_RATIO_LIMITS.en.min; max = DEFAULT_RATIO_LIMITS.en.max; break;
            default: min = DEFAULT_RATIO_LIMITS.vn.min; max = DEFAULT_RATIO_LIMITS.vn.max; break;
        }
    }

    const isJunkOrShort = source.length < 200;
    
    if (isJunkOrShort) {
        min = 0.1;
    }

    // Trả tỷ lệ về đúng với người dùng thiết lập, không nới lỏng ngầm để người dùng dễ kiểm soát
    const effectiveMin = min;
    const effectiveMax = max;

    const roundedRatio = Number(ratio.toFixed(2));
    
    if (roundedRatio < effectiveMin) {
        const fragNote = isFragmentedSource ? ` [Nguồn phân mảnh]` : '';
        return { 
            isValid: false, 
            reason: `Ngôn ngữ: ${detectedLang.toUpperCase()} - Lỗi tỷ lệ: Tỷ lệ (${roundedRatio.toFixed(2)}) quá thấp (< ${effectiveMin.toFixed(2)})${fragNote}`, 
            ratio: roundedRatio,
            isFragmentedSource
        };
    }

    if (roundedRatio > effectiveMax) {
        const fragNote = isFragmentedSource ? ` [Nguồn phân mảnh]` : '';
        return { 
            isValid: false, 
            reason: `Ngôn ngữ: ${detectedLang.toUpperCase()} - Lỗi tỷ lệ: Tỷ lệ (${roundedRatio.toFixed(2)}) quá cao (> ${effectiveMax.toFixed(2)})${fragNote}`, 
            ratio: roundedRatio,
            isFragmentedSource
        };
    }

    // [B] CHECK TRẢ NHẦM KẾT QUẢ HOẶC MẤT ĐẦU / ĐUÔI
    // FIX: dùng normSource/normTarget (đã lọc rác cầu phiếu/cảm ơn tác giả...) thay vì
    // source/target thô — nếu không, các dòng rác chưa lọc sẽ làm phình độ dài phần đuôi
    // của source một cách giả tạo và khiến bước so khớp này báo nhầm mất nội dung.
    if (normSource.length > 500) {
        const srcTailLength = normSource.substring(Math.max(0, normSource.length - 300)).trim().length;
        const tgtTailLength = normTarget.substring(Math.max(0, normTarget.length - 300)).trim().length;
        
        if (srcTailLength > 30 && tgtTailLength < 10) {
            return {
                isValid: false,
                reason: `Nghi vấn trả nhầm kết quả (mất hẳn phần cuối)`,
                ratio: roundedRatio,
                isFragmentedSource
            };
        }

        // FIX: Kiểm tra thiếu cuối chương tinh tế hơn — so sánh độ dài phần đuôi
        // Nếu source dài > 1000 ký tự mà bản dịch thiếu > 15% ở phần cuối thì nghi vấn
        if (normSource.length > 1000 && normTarget.length > 200) {
            const srcTail200 = normSource.substring(Math.max(0, normSource.length - 200)).trim();
            const tgtTail200 = normTarget.substring(Math.max(0, normTarget.length - 200)).trim();
            // Nếu source kết thúc bằng dấu câu hoàn chỉnh nhưng target kết thúc giữa chừng
            const srcEndsComplete = /[.!?。！？…"'»」』】》\u300f]\s*$/.test(srcTail200);
            const tgtEndsAbrupt = tgtTail200.length > 10 && !/[.!?。！？…"'»」』】》\u300f]\s*$/.test(tgtTail200);
            // Chỉ báo lỗi nếu target ngắn hơn nhiều so với mong đợi VÀ kết thúc dở dang
            if (srcEndsComplete && tgtEndsAbrupt && tgtTailLength < srcTailLength * 0.3 && tgtTail200.length < 30) {
                return {
                    isValid: true,
                    reason: `Cảnh báo: Nghi vấn thiếu nội dung cuối chương (phần cuối bị cắt đột ngột)`,
                    ratio: roundedRatio,
                    isFragmentedSource
                };
            }
        }

        const srcHeadLength = normSource.substring(0, 300).trim().length;
        const tgtHeadLength = normTarget.substring(0, 300).trim().length;
        if (srcHeadLength > 50 && tgtHeadLength < 10) {
            return {
                isValid: true,
                reason: `Cảnh báo: Nghi vấn mất hẳn phần đầu`,
                ratio: roundedRatio,
                isFragmentedSource
            };
        }
    }

    // [C] CHECK MẤT ĐẦU CHƯƠNG — Tiêu đề chương bị drop
    // FIX: Bắt cả chương viết bằng chữ Hán (第四十六章) lẫn số Ả Rập (第46章)
    // Thêm các chữ số Hán: 一二三四五六七八九十百千万億 để bắt "第四十六章"
    const CHAPTER_HEADER_RX = /(?:第\s*[\d\u4e00-\u9fa5一二三四五六七八九十百千万億零]+\s*[章話節回幕卷部篇]|Chương\s+[\d一二三四五六七八九十百千]+|Chapter\s+\d+|Hồi\s+\d+|\d+\s*화|제\s*\d+\s*[장화])/i;
    const srcHasHeader = CHAPTER_HEADER_RX.test(normSource.substring(0, 400));
    const tgtHasHeader = CHAPTER_HEADER_RX.test(normTarget.substring(0, 400));

    if (srcHasHeader && !tgtHasHeader) {
        const srcSample = normSource.substring(0, 500);
        const tgtSample = normTarget.substring(0, 500);
        
        const srcNums: string[] = srcSample.match(/\d+/g) || [];
        const tgtNums: string[] = tgtSample.match(/\d+/g) || [];
        const srcLatin: string[] = srcSample.match(/[a-zA-Z]+/g) || [];
        const tgtLatin: string[] = tgtSample.match(/[a-zA-Z]+/g) || [];

        // FIX: Trích số chương từ chữ Hán (第四十六章 → 46) để đối chiếu với bản dịch
        const HANZI_NUM_MAP: Record<string, number> = {
            '零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
            '十':10,'百':100,'千':1000,'万':10000,'億':100000000
        };
        const extractHanziNumber = (s: string): string[] => {
            const found: string[] = [];
            const rx = /第([一二三四五六七八九十百千万億零]+)[章話節回幕卷部篇]/g;
            let m: RegExpExecArray | null;
            while ((m = rx.exec(s)) !== null) {
                const chars = m[1];
                // Convert hanzi number to arabic
                let result = 0, current = 0;
                for (const ch of chars) {
                    const val = HANZI_NUM_MAP[ch] ?? -1;
                    if (val === -1) break;
                    if (val >= 10) {
                        if (current === 0) current = 1;
                        result += current * val;
                        current = 0;
                    } else {
                        current = val;
                    }
                }
                result += current;
                if (result > 0) found.push(String(result));
            }
            return found;
        };

        const srcHanziNums = extractHanziNumber(srcSample);
        const allSrcNums = [...srcNums, ...srcHanziNums];
        
        const hasNumberMatch = allSrcNums.some(n => tgtNums.includes(n));
        const hasLatinMatch = srcLatin.some(l => tgtLatin.includes(l));

        // Kiểm tra xem bản dịch có tiêu đề dạng "Chương X" với số khớp không
        const tgtChapterNums: string[] = (tgtSample.match(/(?:Chương|Hồi|Phần)\s+(\d+)/gi) || [])
            .map(m => m.match(/\d+/)?.[0] || '');
        const hasViChapterMatch = srcHanziNums.some(n => tgtChapterNums.includes(n)) ||
                                   srcNums.some(n => tgtChapterNums.includes(n));
        
        const idealMiddle = (effectiveMin + effectiveMax) / 2;
        const ratioDiff = Math.abs(roundedRatio - idealMiddle) / idealMiddle;
        const isRatioIdeal = ratioDiff < 0.2; // 20% deviation from center
        
        // Nếu đã có "Chương X" trong bản dịch khớp với số gốc → coi là OK
        if (hasViChapterMatch) {
            // OK, tiêu đề đã được dịch đúng
        } else if (!hasNumberMatch && !hasLatinMatch && allSrcNums.length > 0) {
            return {
                isValid: true,
                reason: `Cảnh báo: AI bỏ mất tiêu đề chương ở đầu file và đoạn đầu không khớp gốc`,
                ratio: roundedRatio,
                isFragmentedSource
            };
        } else if (!hasNumberMatch && !hasLatinMatch && allSrcNums.length === 0 && srcLatin.length === 0) {
             if (!isRatioIdeal) {
                  return {
                      isValid: true,
                      reason: `Cảnh báo: AI bỏ mất tiêu đề chương ở đầu file (Ratio: ${roundedRatio.toFixed(2)} lệch chuẩn)`,
                      ratio: roundedRatio,
                      isFragmentedSource
                  };
             }
        }
    }

    // [D] CHECK KÝ TỰ GỐC SÓT — Raw chưa dịch hết
    if (detectedLang !== 'vn' && target.length > 200) {
        const blockSize = 1500;
        let hasDenseBlock = false;
        let denseBlockRatio = 0;
        
        for (let i = 0; i < target.length; i += blockSize) {
            const block = target.substring(i, i + blockSize);
            if (block.length < 100) continue;
            const foreignInBlock = (block.match(/[\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff]/g) || []).length;
            const density = foreignInBlock / block.length;
            if (density > 0.05) {
                hasDenseBlock = true;
                denseBlockRatio = density;
                break;
            }
        }

        if (hasDenseBlock) {
            return {
                isValid: false,
                reason: `Bản dịch có đoạn còn sót tới ${Math.round(denseBlockRatio * 100)}% ký tự gốc — nghi vấn chưa dịch hết`,
                ratio: roundedRatio,
                isFragmentedSource
            };
        }
    }

    // [E] CHECK RÁC AI
    const AI_GARBAGE_RX = /^(?:Dưới đây là|Đây là bản dịch|Chào bạn,|Tôi đã (dịch|xử lý|biên tập)|Here is the translation|Below is)/im;
    if (AI_GARBAGE_RX.test(target.substring(0, 250))) {
        return {
            isValid: false,
            reason: `Phát hiện lời giao tiếp AI lẫn vào đầu bản dịch`,
            ratio: roundedRatio,
            isFragmentedSource
        };
    }

    return { isValid: true, ratio: roundedRatio, isFragmentedSource };
};
