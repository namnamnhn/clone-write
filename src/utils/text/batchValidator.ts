import { FileItem, RatioLimits } from '../../types';
import { validateTranslationIntegrity, removeJunkForValidation } from './validation';

export interface ChapterFingerprint {
    chapterNumber: string | null;   // "123" từ "Chương 123"
    openingKeywords: string[];      // tên nhân vật/địa danh mở đầu
    closingKeywords: string[];      // từ khóa phần cuối
    openingHash: string;            // hash 3 câu đầu
    closingHash: string;
    lineCount: number;
    charCount: number;
}

export interface BatchValidationConfig {
    limits?: RatioLimits;
    sourceLanguages?: string[];
    fingerprints: Map<string, ChapterFingerprint>;
    // Model dùng để dịch batch này. Khi là 'Thủ công' (cứu hộ tay), việc so khớp số chương/
    // keyword giữa các file trong batch không còn ý nghĩa (không có nguy cơ AI trả nhầm batch),
    // nên phải bỏ qua toàn bộ cross-check, chỉ giữ lại check trùng lặp nội dung thô sơ.
    usedModel?: string;
    // Khoá định danh truyện (vd storyInfo.title) để so khớp trùng lặp XUYÊN BATCH qua
    // recentChapterCache bên dưới. Không truyền -> bỏ qua cross-check xuyên batch (giữ hành vi cũ).
    storyKey?: string;
}

export interface BatchValidationResult {
    isValid: boolean;
    reason?: string;
    contentConfidence: number; // 0 to 1
    warnings: string[];
}

export interface BatchValidationReport {
    details: Map<string, BatchValidationResult>;
}

const HANZI_NUM_MAP: Record<string, number> = {
    '零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
    '十':10,'百':100,'千':1000,'万':10000,'億':100000000
};

function parseHanziNumber(chars: string): string | null {
    if (chars === '零') return "0";
    let result = 0, current = 0;
    for (const ch of chars) {
        const val = HANZI_NUM_MAP[ch] ?? -1;
        if (val === -1) return null;
        if (val >= 10) {
            if (current === 0) current = 1;
            result += current * val;
            current = 0;
        } else {
            current = val;
        }
    }
    result += current;
    return result >= 0 ? String(result) : null;
}

function extractChapterNumber(text: string): string | null {
    // Search a bit further than before (150 chars) since a Volume/Quyển prefix
    // often pushes the real Chapter marker back a little.
    const head = text.substring(0, 150);

    // Priority 1: Chinese "第X章" (chapter). Use the LAST match in the head, because
    // raw sources are frequently formatted as "第2卷 第16章..." (Volume 2, Chapter 16) —
    // the volume marker "第2卷" appears first and must NOT win over the real chapter.
    const cnChapterMatches = [...head.matchAll(/第\s*(\d+|[一二三四五六七八九十百千万億零]+)\s*[章話節回幕]/g)];
    if (cnChapterMatches.length > 0) {
        const lastMatch = cnChapterMatches[cnChapterMatches.length - 1][1];
        if (/^\d+$/.test(lastMatch)) {
            return parseInt(lastMatch, 10).toString();
        } else {
            const parsed = parseHanziNumber(lastMatch);
            if (parsed) return parsed;
        }
    }

    // Priority 2: Vietnamese/English "Chương N" / "Chapter N" (word-bounded).
    const chapterMatch = head.match(/\b(?:Chương|Chapter)\.?\s*(\d+)\b/i);
    if (chapterMatch) {
        return parseInt(chapterMatch[1], 10).toString();
    }

    // Priority 3: "Ch" abbreviation — word-bounded on both sides so it can't match
    // as a substring inside unrelated words (previously matched anywhere, e.g. inside
    // random text that happened to contain "ch" followed by a digit).
    const chAbbrevMatch = head.match(/\bCh\.?\s*(\d+)\b/i);
    if (chAbbrevMatch) {
        return parseInt(chAbbrevMatch[1], 10).toString();
    }

    // NOTE: Deliberately NOT treating bare "Vol"/"Volume"/"第" (without 章) as a chapter
    // identity anymore. A Volume/Part number is NOT a Chapter number — conflating them
    // was the root cause of mass false-positive "Nghi vấn nhầm chương" rejections: every
    // chapter inside the same volume got the same (wrong) source chapter number, so the
    // validator rejected almost every file in that volume and burned through the request
    // quota re-queuing them.

    // Fallback for lines starting directly with a number (e.g. "1. Bắt đầu", "12 - The Beginning")
    // Only match if it's at the very start of the string, optionally preceded by spaces or symbols
    const implicitMatch = head.match(/^\s*[^a-zA-Z0-9]*(\d+)[\s.:-]/);
    if (implicitMatch) {
        return parseInt(implicitMatch[1], 10).toString();
    }
    return null;
}

function extractKeywords(text: string): string[] {
    const words = text.split(/[\s,.;:!?]+/).filter(w => w.length > 2);
    // return first 10 significant words
    return words.slice(0, 10);
}

function computeHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

function computeBodyHash(text: string): string {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    // Bỏ dòng tiêu đề (thường là dòng đầu tiên)
    const body = lines.length > 1 ? lines.slice(1).join('\n') : text;
    return computeHash(body.substring(0, 500));
}

// FIX (lọt lưới "đầu chương này/đuôi chương kia"): computeBodyHash() ở trên chỉ hash 500 ký tự
// ĐẦU của thân bài, nên 2 file trùng nội dung ở ĐUÔI nhưng khác nhau ở ĐẦU (kiểu lỗi ghép chồng
// batch phổ biến nhất) không bị bắt bởi check trùng lặp head-hash. Thêm hash riêng cho 500 ký tự
// CUỐI để bắt đúng dạng lỗi này — dùng chung logic bỏ dòng tiêu đề như bản head để nhất quán.
function computeClosingBodyHash(text: string): string {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const body = lines.length > 1 ? lines.slice(1).join('\n') : text;
    return computeHash(body.substring(Math.max(0, body.length - 500)));
}

// FIX (báo trùng giả giữa các chương có "kết mẫu" giống nhau): nhiều truyện chương nào cũng kết
// bằng đoạn boilerplate dài đúng 1 kiểu (lời dẫn "mời đọc chương sau", banner preview cố định...).
// Nếu chỉ so 500 ký tự CUỐI, 2 chương KHÁC HOÀN TOÀN nhưng cùng đuôi mẫu sẽ bị coi là trùng lặp,
// trừ 0.8 confidence oan -> bắt dịch lại/khoá cứu hộ không cần thiết. Thêm lớp hash thứ 2 cho
// 500 ký tự LIỀN TRƯỚC đoạn đuôi ("mid-tail"): chỉ khi CẢ 2 vùng đều khớp (~1000 ký tự liên tục)
// mới đủ điều kiện coi là trùng đuôi thật sự - boilerplate hiếm khi dài tới vậy, còn nội dung bị
// ghép nhầm/contamination thì thường trùng dài hơn nhiều nên vẫn bắt được như cũ.
function computeMidTailBodyHash(text: string): string {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const body = lines.length > 1 ? lines.slice(1).join('\n') : text;
    const end = Math.max(0, body.length - 500);
    return computeHash(body.substring(Math.max(0, end - 500), end));
}

// ---- CROSS-BATCH RECENT CHAPTER CACHE ----
// Mọi cross-check ở validateBatch() bên dưới (trùng lặp nội dung, trùng số chương, trùng
// keyword đầu/cuối) trước đây CHỈ so sánh GIỮA CÁC FILE TRONG CÙNG 1 LẦN GỌI validateBatch, tức
// cùng 1 batch dịch cụ thể. Nếu 2 chương liền kề (vd chương 34 và 35) rơi vào 2 lượt dịch/cứu hộ
// KHÁC NHAU (rất dễ xảy ra: batch bị chia lại giữa chừng, 1 trong 2 phải dịch lại riêng lẻ, dịch
// gián đoạn giữa các phiên...), sẽ không có bước nào so sánh nội dung giữa chúng — kể cả khi 1
// trong 2 file dính đúng đoạn kết của file kia. Cache nhỏ, giữ lại vân tay (fingerprint) phần
// ĐUÔI của N chương gần nhất đã hoàn tất (gắn khoá theo tên truyện để tránh lẫn giữa các truyện
// khác nhau đang dịch song song), cho phép bắt được cả trường hợp trùng lặp XUYÊN BATCH này.
// Sống trong bộ nhớ theo phiên làm việc (mất khi tải lại trang) — chấp nhận được vì mục đích chỉ
// là bắt lỗi NGAY LÚC ĐANG DỊCH, không phải lưu trữ lâu dài.
interface RecentChapterFingerprint {
    id: string;
    closingBodyHash: string;
    midClosingBodyHash: string;
}
const RECENT_CHAPTERS_PER_STORY = 40;
const recentChapterCache = new Map<string, RecentChapterFingerprint[]>(); // key: storyKey

export const registerCompletedChapterFingerprint = (
    storyKey: string | undefined,
    fileId: string,
    translatedContent: string
): void => {
    if (!translatedContent) return;
    const key = storyKey || '__default__';
    const cleaned = removeJunkForValidation(translatedContent) || translatedContent;
    const entry: RecentChapterFingerprint = {
        id: fileId,
        closingBodyHash: computeClosingBodyHash(cleaned),
        midClosingBodyHash: computeMidTailBodyHash(cleaned)
    };
    const list = recentChapterCache.get(key) || [];
    // Xoá entry cũ của cùng file (vd file được dịch lại) trước khi thêm bản mới nhất, tránh cache
    // giữ vân tay lỗi thời của chính nó rồi tự báo trùng với chính mình ở lượt sau.
    const filtered = list.filter(e => e.id !== fileId);
    filtered.push(entry);
    while (filtered.length > RECENT_CHAPTERS_PER_STORY) filtered.shift();
    recentChapterCache.set(key, filtered);
};

export const createBatchFingerprints = (files: { id: string; content: string }[]): Map<string, ChapterFingerprint> => {
    const map = new Map<string, ChapterFingerprint>();
    files.forEach(f => {
        const rawContent = f.content || '';
        // Loại quảng cáo/tâm sự/chú thích/tên converter trước khi lấy fingerprint, để việc bản
        // dịch lược bỏ các phần này (hợp lệ) không bị tính là "lệch nội dung" so với bản gốc.
        const content = removeJunkForValidation(rawContent) || rawContent;
        const opening = content.substring(0, 500);
        const closing = content.substring(Math.max(0, content.length - 500));
        map.set(f.id, {
            chapterNumber: extractChapterNumber(opening),
            openingKeywords: extractKeywords(opening),
            closingKeywords: extractKeywords(closing),
            openingHash: computeHash(opening),
            closingHash: computeHash(closing),
            lineCount: content.split('\n').filter(l => l.trim().length > 0).length,
            charCount: content.length
        });
    });
    return map;
};

function getKeywordOverlap(k1: string[], k2: string[]): number {
    const set2 = new Set(k2.map(k => k.toLowerCase()));
    let overlap = 0;
    for (const w of k1) {
        if (set2.has(w.toLowerCase())) overlap++;
    }
    return overlap;
}

export const validateBatch = (
    files: FileItem[],
    results: Map<string, string>,
    config: BatchValidationConfig
): BatchValidationReport => {
    const report: BatchValidationReport = { details: new Map() };

    // Pre-calculate translated infos for cross-checking
    const translatedInfos = new Map<string, { chapterNum: string | null; bodyHash: string; closingBodyHash: string; midClosingBodyHash: string; keywords: string[]; closingKeywords: string[] }>();
    files.forEach(file => {
        const rawTargetContent = results.get(file.id);
        if (rawTargetContent) {
            const targetContent = removeJunkForValidation(rawTargetContent) || rawTargetContent;
            const opening = targetContent.substring(0, 500);
            const closing = targetContent.substring(Math.max(0, targetContent.length - 500));
            translatedInfos.set(file.id, {
                chapterNum: extractChapterNumber(opening),
                bodyHash: computeBodyHash(targetContent),
                closingBodyHash: computeClosingBodyHash(targetContent),
                midClosingBodyHash: computeMidTailBodyHash(targetContent),
                keywords: extractKeywords(opening),
                closingKeywords: extractKeywords(closing)
            });
        }
    });

    files.forEach(file => {
        const targetContent = results.get(file.id);
        if (!targetContent) {
            report.details.set(file.id, {
                isValid: false,
                reason: "Không có nội dung dịch",
                contentConfidence: 0,
                warnings: ["Lỗi: Trống nội dung (0%)"]
            });
            return;
        }

        const sourceConfig = config.fingerprints.get(file.id);
        const translatedInfo = translatedInfos.get(file.id);
        const translatedChapterNum = translatedInfo?.chapterNum || null;
        const warnings: string[] = [];
        let confidence = 1.0;

        // Dịch thủ công (cứu hộ tay) không thể bị AI "trả nhầm batch" — người dùng tự dán nội
        // dung đúng chương của họ vào. Mọi sai lệch số chương lúc này chỉ có thể do cách trích
        // xuất số chương (regex) đọc nhầm, KHÔNG phải lỗi ghép sai chương thật sự => bỏ qua
        // toàn bộ cross-check số chương/keyword, chỉ giữ lại check trùng lặp nội dung ở trên.
        const isManualTranslation = config.usedModel === 'Thủ công';

        // Batch chỉ có 1 file thì không có nguy cơ "hoán vị chéo" với file khác trong cùng mẻ
        // gửi AI (không có file nào khác để mà lẫn vào). Vẫn cần cảnh báo nếu số chương lệch,
        // nhưng không nên trừ điểm nặng ngang mức nghi vấn hoán vị thật sự.
        const isSingleFileBatch = config.fingerprints.size <= 1;

        // Cơ bản: Kiểm tra Ratio
        const baseValidation = validateTranslationIntegrity(file.content, targetContent, config.limits, config.sourceLanguages);
        if (!baseValidation.isValid) {
            confidence -= 0.5;
            warnings.push(`Ratio Error: ${baseValidation.reason}`);
        }

        // Duplicate-content detection — kiểm tra CẢ đầu (bodyHash) LẪN đuôi (closingBodyHash), vì
        // hai file có thể khác nhau hoàn toàn ở đầu nhưng lại dính đúng đoạn kết của nhau (kiểu lỗi
        // ghép sai batch phổ biến "đầu chương này, đuôi chương kia" mà check chỉ-hash-đầu bỏ lọt).
        let isDuplicateHead = false;
        let isDuplicateTail = false;
        translatedInfos.forEach((info, otherId) => {
            if (otherId === file.id) return;
            if (info.bodyHash === translatedInfo?.bodyHash) isDuplicateHead = true;
            // Đuôi chỉ được coi là trùng khi CẢ 2 lớp hash (500 ký tự cuối + 500 ký tự liền trước)
            // đều khớp — tránh báo oan các chương chỉ trùng đoạn "kết mẫu" boilerplate ngắn.
            if (info.closingBodyHash === translatedInfo?.closingBodyHash && info.midClosingBodyHash === translatedInfo?.midClosingBodyHash) isDuplicateTail = true;
        });
        const isDuplicate = isDuplicateHead || isDuplicateTail;

        if (isDuplicateHead && isDuplicateTail) {
            confidence -= 0.8;
            warnings.push("Phát hiện trùng lặp nội dung (duplicate content) cả đầu lẫn cuối với file khác trong cùng batch.");
        } else if (isDuplicateHead) {
            confidence -= 0.8;
            warnings.push("Phát hiện trùng lặp nội dung (duplicate content) ở phần ĐẦU với file khác trong cùng batch.");
        } else if (isDuplicateTail) {
            confidence -= 0.8;
            warnings.push("Phát hiện trùng lặp nội dung (duplicate content) ở phần CUỐI với file khác trong cùng batch (nghi vấn kiểu 'đầu chương này, đuôi chương kia').");
        }

        // Cross-check XUYÊN BATCH: so đuôi file này với đuôi các chương đã hoàn tất TRƯỚC ĐÓ
        // (có thể ở lượt dịch/cứu hộ khác), bỏ qua file nào đang nằm trong CHÍNH batch hiện tại
        // (đã được check ở trên rồi, tránh báo trùng 2 lần cho cùng 1 cặp).
        if (!isDuplicateTail && config.storyKey && translatedInfo) {
            const recentList = recentChapterCache.get(config.storyKey) || [];
            const currentBatchIds = new Set(files.map(f => f.id));
            const crossMatch = recentList.find(entry =>
                entry.id !== file.id &&
                !currentBatchIds.has(entry.id) &&
                entry.closingBodyHash === translatedInfo.closingBodyHash &&
                entry.midClosingBodyHash === translatedInfo.midClosingBodyHash
            );
            if (crossMatch) {
                confidence -= 0.8;
                warnings.push(`Phát hiện trùng lặp nội dung (duplicate content) ở phần CUỐI với chương đã dịch trước đó, khác batch hiện tại (file: ${crossMatch.id}) — nghi vấn kiểu 'đầu chương này, đuôi chương kia' giữa 2 lượt dịch riêng biệt.`);
            }
        }

        // Căn bản: Kiểm tra Cross-contamination & Offset
        if (sourceConfig && !isManualTranslation) {
            if (sourceConfig.chapterNumber && translatedChapterNum) {
                if (sourceConfig.chapterNumber !== translatedChapterNum) {
                    const srcNum = parseInt(sourceConfig.chapterNumber, 10);
                    const transNum = parseInt(translatedChapterNum, 10);
                    
                    let matchOtherFile = false;
                    config.fingerprints.forEach((f, id) => {
                        if (id !== file.id && f.chapterNumber === translatedChapterNum) {
                            matchOtherFile = true;
                        }
                    });

                    if (matchOtherFile) {
                        // Khớp với 1 file KHÁC đang có trong batch
                        confidence -= 0.9;
                        warnings.push(`Nghi vấn hoán vị: Gốc là chương ${sourceConfig.chapterNumber}, nhưng dịch trả về chương ${translatedChapterNum} (thuộc file khác trong batch)`);
                    } else if (isSingleFileBatch) {
                        // Batch 1 file: không có file nào khác để mà "hoán vị" nhầm vào. Lệch số
                        // chương ở đây gần như chắc chắn là do trích xuất số chương đọc lệch
                        // (quảng cáo/tiền tố đánh số bài đăng/chú thích), không phải lỗi ghép sai
                        // batch. Chỉ cảnh báo nhẹ để người dùng để ý, không tự động đánh rớt.
                        confidence -= 0.15;
                        warnings.push(`Lưu ý: Gốc là chương ${sourceConfig.chapterNumber}, bản dịch đọc được chương ${translatedChapterNum} (batch chỉ có 1 file, khả năng cao do khác biệt định dạng/tiền tố, không phải nhầm batch).`);
                    } else {
                        const diff = Math.abs(srcNum - transNum);
                        if (diff === 1 || diff === 2) {
                            // Lệch đúng ±1/±2 so với số gốc
                            confidence -= 0.75;
                            warnings.push(`Nghi vấn lệch batch liền kề: Gốc là chương ${sourceConfig.chapterNumber}, nhưng dịch trả về chương ${translatedChapterNum} (lệch ${diff})`);
                        } else {
                            // Lệch số bất kỳ khác
                            confidence -= 0.7;
                            warnings.push(`Nghi vấn nhầm chương: Gốc là chương ${sourceConfig.chapterNumber}, nhưng bản dịch là chương ${translatedChapterNum}`);
                        }
                    }
                }
            } else if (!sourceConfig.chapterNumber && translatedChapterNum) {
                // Nếu file gốc thuộc Dạng 2 (chỉ số thứ tự, không nội dung tiêu đề) hoặc Dạng 3
                // (thuần văn bản, không marker) — hoặc tiêu đề hiện tại là do bước "Chuẩn hoá
                // tiêu đề" (AI) tự sinh hợp lệ — thì việc bản dịch có xuất hiện số chương là
                // BÌNH THƯỜNG (do AI được phép format/đặt số thứ tự chương khi dịch), KHÔNG
                // phải dấu hiệu lệch nội dung. Chỉ áp cảnh báo đầy đủ cho Dạng 1 thật sự có tiêu
                // đề gốc mà lại không trích xuất được số chương (trường hợp hiếm, có thể do regex).
                const isExpectedFormat = file.chapterFormat === 'numbered' || file.chapterFormat === 'untitled' || file.titleGeneratedByAI;

                // Gốc không có chương, nhưng dịch trả về có chương -> coi chừng bị chập nội dung
                let matchOtherFile = false;
                config.fingerprints.forEach((f, id) => {
                    if (id !== file.id && f.chapterNumber === translatedChapterNum) {
                        matchOtherFile = true;
                    }
                });
                
                if (matchOtherFile) {
                    // Dù là Dạng 2/3, nếu số chương lại trùng khớp với 1 file KHÁC trong batch thì
                    // vẫn là dấu hiệu đáng ngờ thật sự (không thể giải thích bằng việc AI tự đặt số).
                    confidence -= 0.4;
                    warnings.push(`Nghi vấn nhảy nội dung: Gốc không có số chương, nhưng bản dịch trả về kết quả chương ${translatedChapterNum} (thuộc file khác)`);
                } else if (!isExpectedFormat) {
                    confidence -= 0.1;
                    warnings.push(`Gốc không có số chương nhưng bản dịch có số chương ${translatedChapterNum}`);
                }
                // isExpectedFormat && !matchOtherFile: không trừ điểm, không cảnh báo — đúng như kỳ vọng.
            } else if (sourceConfig.chapterNumber && !translatedChapterNum) {
                confidence -= 0.1;
                warnings.push(`Gốc có số chương ${sourceConfig.chapterNumber} nhưng bản dịch không có.`);
            }

            // Keyword overlap check GIỮA CÁC BẢN DỊCH trong cùng batch (đều là tiếng Việt) —
            // phát hiện hiện tượng "đầu chương này, đuôi chương khác" một cách có ý nghĩa.
            // KHÔNG so khớp trực tiếp keyword bản dịch (luôn tiếng Việt) với keyword bản GỐC
            // (có thể là tiếng Trung/Hàn/Nhật/Anh) như cách cũ — vì khác ngôn ngữ hoàn toàn nên
            // overlap gần như luôn = 0 hoặc ngẫu nhiên, đây chính là nguyên nhân gây báo oan
            // hàng loạt khi app xử lý nhiều ngôn ngữ nguồn khác nhau.
            if (translatedInfo && !isDuplicate && config.fingerprints.size > 1) {
                let bestOpeningMatchId: string | null = null;
                let maxOpeningOverlap = 0;
                let bestClosingMatchId: string | null = null;
                let maxClosingOverlap = 0;

                translatedInfos.forEach((otherInfo, otherId) => {
                    if (otherId === file.id) return;
                    // Ngưỡng cao hơn (>= 6) vì giờ so cùng ngôn ngữ Việt — câu văn thông dụng
                    // (VD: "hắn nói rằng", "trong lòng nghĩ thầm") dễ trùng vài từ một cách vô hại,
                    // cần overlap đủ lớn mới đáng ngờ.
                    const openingOverlap = getKeywordOverlap(translatedInfo.keywords, otherInfo.keywords);
                    if (openingOverlap > maxOpeningOverlap && openingOverlap >= 6) {
                        maxOpeningOverlap = openingOverlap;
                        bestOpeningMatchId = otherId;
                    }

                    const closingOverlap = getKeywordOverlap(translatedInfo.closingKeywords, otherInfo.closingKeywords);
                    if (closingOverlap > maxClosingOverlap && closingOverlap >= 6) {
                        maxClosingOverlap = closingOverlap;
                        bestClosingMatchId = otherId;
                    }
                });

                if (bestOpeningMatchId) {
                    confidence -= 0.3;
                    warnings.push(`Nghi vấn trùng nội dung: Đoạn mở đầu bản dịch giống bất thường với 1 file khác trong cùng batch.`);
                }

                if (bestClosingMatchId) {
                    confidence -= 0.3;
                    warnings.push(`Nghi vấn trùng nội dung: Đoạn kết bản dịch giống bất thường với 1 file khác trong cùng batch.`);
                }
            }
        }

        report.details.set(file.id, {
            isValid: confidence >= 0.4,
            contentConfidence: Math.max(0, confidence),
            warnings
        });
    });

    return report;
};
