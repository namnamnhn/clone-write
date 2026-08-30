// Logic tách chương: theo regex (title-based) và theo độ dài ký tự (length-based).
import { FileItem, FileStatus } from '../../types';
import { REGEX_PATTERNS } from '../regexPatterns';
import { padNumber, sanitizeFilename } from './shared';
import { cleanGarbageText } from '../text/garbageCleaner';

// Only Arabic-digit numbered markers (第2章, Chương 2, 2話, ...) are reliable enough to
// treat as a valid chapter split even when glued directly to the previous sentence with
// ZERO separator (no space/punctuation/newline before it) -- a common artifact of raw
// scraped sources. Bare keywords (番外/序章/Prologue/...) and Chinese-numeral markers
// (第一回, 第二回...) occur too often as ordinary words/phrases inside running prose to
// risk this relaxed check, so they still require a real separator before them.
const DIGIT_CHAPTER_MARKER = /^(?:(?:第|제)\s*[0-9０-９]+(?:\.[0-9]+)?\s*[章回节節卷集話话篇部]|[0-9０-９]+\s*[話话](?!\w)|제\s*[0-9０-９]+\s*[장화편권절부]|[0-9０-９]+\s*[화장편](?!\w)|(?:Chương|Hồi|Phần|Quyển|Tập|Chapter|Volume|Book|Part)\s*[0-9０-９]+(?:\.[0-9]+)?)/i;
// Closing-bracket/quote characters: if the text right after a glued marker still contains
// one of these before the line ends, we're likely still inside a quoted metadata block
// (e.g. 『trạng thái: cập nhật đến chương X』) rather than looking at a real chapter title.
const CLOSE_BRACKET_CHARS = /[】》』”"'）\)]/;

// Bóc phần "số thứ tự + marker" (Chương 12 / 第12章 / Chapter 12 / Hồi 12 / Ch.12 / ...) ra khỏi
// đầu dòng tiêu đề, để xét phần còn lại có phải là nội dung tiêu đề thật hay không. Dùng để
// phân biệt 3 dạng chương: Dạng 1 (số + nội dung tiêu đề), Dạng 2 (chỉ có số thứ tự), Dạng 3
// (không có marker nào cả — thuần văn bản). Việc gắn nhãn này giúp hậu kiểm áp đúng mức kỳ
// vọng cho từng dạng thay vì coi "không có tiêu đề" là dấu hiệu lệch nội dung.
const CHAPTER_MARKER_STRIP = /^(?:第\s*[0-9０-９零一二三四五六七八九十百千万萬兩两]+\s*[章話節回幕卷部]|Chương\s*\d+|Chapter\s*\d+|Hồi\s*\d+|Tiết\s*\d+|Quyển\s*\d+|Tập\s*\d+|Phần\s*\d+|Ch\.?\s*\d+|\d+)/i;

export function detectChapterFormat(title: string): 'titled' | 'numbered' | 'untitled' {
    if (!title || title === "Mở đầu / Giới thiệu") return 'untitled';
    const stripped = title.replace(CHAPTER_MARKER_STRIP, '').replace(/^[\s:：\-–—.,]+/, '').trim();
    return stripped ? 'titled' : 'numbered';
}

// Khi tiêu đề chương dính liền ngay với câu văn đầu tiên trên CÙNG một dòng vật lý (rất hay gặp
// ở nguồn convert thô, không xuống dòng giữa tiêu đề và nội dung), nếu giữ nguyên cả dòng làm
// currentTitle thì lúc dịch, AI sẽ hiểu lầm toàn bộ dòng (bao gồm cả câu văn đầu) là tiêu đề rồi
// định dạng lại thành "Chương X: <tiêu đề>...<câu văn đầu bị bốc theo>". Hàm này tách dòng ra
// thành {title, bodyRemainder} NGAY TỪ LÚC TÁCH CHƯƠNG (trước khi gửi đi dịch), áp dụng được cho
// nhiều ngôn ngữ nguồn (không riêng tiếng Việt) vì chỉ dựa vào dấu câu kết câu phổ biến.
function splitInlineTitleFromBody(cleanLine: string): { title: string; bodyRemainder: string } {
    // Chỉ tách khi tìm được dấu câu kết câu KHÔNG mơ hồ (không dùng dấu " hay ' trần vì đây là
    // ký tự 2 chiều — vừa có thể là mở ngoặc vừa là đóng ngoặc — dễ tách nhầm ngay sau dấu mở).
    // KHÔNG dùng ngưỡng độ dài ký tự cố định để quyết định có nên thử tách hay không: tiếng
    // Trung/Nhật/Hàn biểu đạt nhiều ý nghĩa hơn trong ít ký tự hơn nhiều so với tiếng Việt/Anh,
    // nên một dòng tiêu đề+nội dung dính liền bằng CJK có thể ngắn hơn 80 ký tự mà vẫn cần tách.
    const match = cleanLine.match(/^([\s\S]{1,100}?[.!?。！？…!?)）”’】』」》])\s*([\s\S]{15,})$/);
    if (match) {
        return { title: match[1].trim(), bodyRemainder: match[2].trim() };
    }
    // Không tìm được điểm ngắt rõ ràng bằng dấu câu -> GIỮ NGUYÊN cả dòng, không đoán mò cắt
    // cứng theo số ký tự (một tiêu đề dài nhưng hợp lệ, không dấu câu, vẫn có thể xảy ra thật sự
    // — ví dụ tiêu đề chương kiểu Trung Quốc dài dòng — và không nên bị phá vỡ giữa chừng).
    return { title: cleanLine, bodyRemainder: '' };
}

export const splitContentByRegex = (content: string, customRegex?: string, cleanGarbage: boolean = true): FileItem[] => {
    // UPDATED: Use Universal Regex Pattern if custom is not provided
    const regex = customRegex ? new RegExp(customRegex, 'im') : REGEX_PATTERNS.UNIVERSAL_CHAPTER_MATCH;
    // FIX: the inline fallback ALWAYS uses the built-in multilingual inline matcher, never
    // the raw customRegex. Preset/custom regexes carry ^...$ anchors meant for whole-line
    // testing; reusing them for "find a match anywhere in this giant merged line" testing
    // makes them only ever match at position 0, silently breaking inline detection (this
    // was the cause of the Trung/Hàn preset only finding 33/3013 chapters).
    const inlineRegex = REGEX_PATTERNS.INLINE_CHAPTER_MATCH;
    
    const cleanSource = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = cleanSource.split('\n');
    const preprocessedLines: string[] = [];
    
    // Tiền xử lý: Bẻ tách tiêu đề bị dính inline với văn bản đoạn trước
    for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            preprocessedLines.push(rawLine);
            continue;
        }
        
        // Nếu đã là một dòng ngắn báo hiệu chương hoặc khớp chính xác thì kệ nó
        if (regex.test(trimmed) && trimmed.length < 120) {
            preprocessedLines.push(rawLine);
            continue;
        }
        
        // Dính inline
        const match = trimmed.match(inlineRegex);
        if (match && match.index && match.index > 0) {
            // Check to avoid breaking quotes or brackets if possible, optional logic
            const matchIndex = match.index;
            const charBefore = trimmed.charAt(matchIndex - 1);
            const remainder = trimmed.substring(matchIndex + match[0].length);
            // Chỉ tách nếu đằng trước là khoảng trắng, dấu câu hoặc đầu câu để tránh cắt vụn chữ "第一回" (lần đầu tiên) nằm giữa câu
            // HOẶC nếu marker là số Ả Rập dính liền thẳng vào câu trước (không có bất kỳ dấu phân cách nào -
            // lỗi thường gặp ở nguồn convert thô), với điều kiện phần còn lại tới cuối dòng ngắn gọn như
            // một tiêu đề thật (không phải câu văn đang tiếp diễn) và không chứa dấu đóng ngoặc/trích dẫn dở dang.
            const isValidInline =
                /[\s.!?。！？\]】”"']/.test(charBefore) ||
                (DIGIT_CHAPTER_MARKER.test(match[0]) && remainder.length <= 30 && !CLOSE_BRACKET_CHARS.test(remainder));
            
            if (isValidInline) {
                const before = rawLine.substring(0, rawLine.indexOf(match[0])).trimEnd();
                const chapterPart = rawLine.substring(rawLine.indexOf(match[0]));
                if (before) {
                    preprocessedLines.push(before);
                }
                preprocessedLines.push(chapterPart);
            } else {
                preprocessedLines.push(rawLine);
            }
        } else {
            preprocessedLines.push(rawLine);
        }
    }
    
    const lines = preprocessedLines;
    const files: FileItem[] = [];
    let currentBuffer: string[] = [];
    let currentTitle = "Mở đầu / Giới thiệu";
    
    const finalizeChapter = (title: string, buffer: string[]) => {
        if (buffer.length === 0) return;
        if (buffer.length > 0 && /^(?:###)?\s*EPUB_CHAPTER_SPLIT/.test(buffer[0])) buffer.shift();
        const rawContent = (cleanGarbage ? cleanGarbageText(buffer.join('\n')) : buffer.join('\n')).trim();
        if (rawContent.length < 30) return; // Skip ghost chapters
        let safeTitle = sanitizeFilename(title).replace(/^###EPUB_CHAPTER_SPLIT###\s*/, '').replace(/^[\*\->=\s]+/, '').trim();
        // Add space after chapter if missing (for Chinese/Vietnamese)
        safeTitle = safeTitle.replace(/^(第\s*[0-9０-９零一二三四五六七八九十百千万萬兩两]+\s*[章話節回幕卷部]|Chương\s*\d+|Hồi\s*\d+|Tiết\s*\d+|Quyển\s*\d+|Tập\s*\d+|Phần\s*\d+)(?=[^\s:：\-])/i, '$1 ');
        
        if (safeTitle.length > 80) safeTitle = safeTitle.substring(0, 80) + "...";
        // Index is files.length + 1
        const index = files.length + 1;
        if (!safeTitle) safeTitle = `Chương ${index}`;
        files.push({ id: crypto.randomUUID(), name: `${padNumber(index)} ${safeTitle}`, content: rawContent, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: rawContent.length, remainingRawCharCount: 0, chapterFormat: detectChapterFormat(title) });
    };
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) { currentBuffer.push(line); continue; }
        const cleanLine = trimmedLine.replace(/^[\s\*\->=\+]+/, '');
        if (regex.test(cleanLine)) {
            if (currentBuffer.length > 0) {
                finalizeChapter(currentTitle, currentBuffer);
            }
            const { title, bodyRemainder } = splitInlineTitleFromBody(cleanLine);
            currentTitle = title;
            // Nếu tách được phần nội dung dính liền ra khỏi tiêu đề, đưa tiêu đề và nội dung
            // xuống 2 dòng riêng biệt (thay vì để nguyên 1 dòng dài) — để khi gửi đi dịch, AI
            // không hiểu nhầm câu văn đầu là một phần của tiêu đề.
            currentBuffer = bodyRemainder ? [title, '', bodyRemainder] : [line];
        } else {
            currentBuffer.push(line);
        }
    }
    finalizeChapter(currentTitle, currentBuffer);
    
    if (files.length === 0 && cleanSource.length > 0) {
         files.push({ id: crypto.randomUUID(), name: "00001 Toàn Văn (Không tách được)", content: cleanSource, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: cleanSource.length, remainingRawCharCount: 0, chapterFormat: 'untitled' });
    }
    return files;
};

// FIX (rò rỉ marker nội bộ ra "bản gốc" hiển thị cho người dùng): khi bật "Chèn Title Anchor"
// lúc tách theo độ dài ký tự (splitContentByLength, mode 'preserve'), app chèn tiền tố
// "__TITLE_ANCHOR__: " vào ĐẦU các dòng nhận diện là tiêu đề chương, để AI dịch biết đâu là
// điểm bắt đầu 1 chương thật khi 1 chương bị cắt vụn thành nhiều phần theo giới hạn ký tự.
// Marker này CẦN được giữ lại trong `file.content` vì nó là một phần dữ liệu gửi cho AI dịch
// (xem prompts/translation.ts) - nhưng bản thân văn bản gốc thực sự KHÔNG hề có cụm này, nên
// bất kỳ nơi nào hiển thị/copy/xuất "bản gốc" cho người dùng xem thì phải lọc bỏ nó trước, nếu
// không người dùng sẽ thấy nó bị "chèn" vào bản gốc như thể app tự ý sửa nội dung nguồn (đây
// chính là điều người dùng phản ánh). Hàm export dùng chung này để mọi nơi hiển thị raw dùng
// đúng 1 chỗ duy nhất, tránh lặp lại regex rải rác nhiều nơi dễ quên/thiếu sót.
export const stripTitleAnchor = (content: string): string => {
    if (!content) return content;
    return content.replace(/^__TITLE_ANCHOR__:[ \t]*/gim, "");
};

export const splitContentByLength = (content: string, charLimit: number = 6000, mode: 'preserve' | 'reindex' = 'preserve', embedTitleAnchor: boolean = false, cleanGarbage: boolean = true): FileItem[] => {
    let cleanSource = content.replace(/^(?:###)?\s*EPUB_CHAPTER_SPLIT\s*.*$/gim, '');
    
    if (embedTitleAnchor && mode === 'preserve') {
        const regex = REGEX_PATTERNS.UNIVERSAL_CHAPTER_MATCH;
        const lines = cleanSource.split('\n');
        cleanSource = lines.map(line => {
            if (line.trim() && regex.test(line.replace(/^[\s\*\->=\+]+/, ''))) {
                return `__TITLE_ANCHOR__: ${line.trim()}`;
            }
            return line;
        }).join('\n');
    }

    const files: FileItem[] = [];
    let currentIndex = 0;
    let partCount = 1;
    const totalLen = cleanSource.length;
    while (currentIndex < totalLen) {
        let endIndex = Math.min(currentIndex + charLimit, totalLen);
        if (endIndex < totalLen) {
            const nextNewline = cleanSource.indexOf('\n', endIndex);
            if (nextNewline !== -1 && (nextNewline - endIndex) < 500) endIndex = nextNewline + 1; 
            else {
                 const prevNewline = cleanSource.lastIndexOf('\n', endIndex);
                 if (prevNewline > currentIndex) endIndex = prevNewline + 1;
            }
        }
        const chunkText = (cleanGarbage ? cleanGarbageText(cleanSource.substring(currentIndex, endIndex)) : cleanSource.substring(currentIndex, endIndex)).trim();
        if (chunkText.length > 0) {
             let finalContent = chunkText;
             let finalName = "";
             if (mode === 'reindex') {
                 const header = `Chương ${partCount}`;
                 finalName = `${padNumber(partCount)} ${header}`;
                 finalContent = `${header}\n\n${chunkText}`;
             } else {
                 finalName = `${padNumber(partCount)} Part ${partCount} (Split)`;
             }
             files.push({ id: crypto.randomUUID(), name: finalName, content: finalContent, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: chunkText.length, remainingRawCharCount: 0 });
            partCount++;
        }
        currentIndex = endIndex;
    }
    return files;
};
