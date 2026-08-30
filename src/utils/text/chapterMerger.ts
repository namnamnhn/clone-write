import { FileItem, FileStatus } from "../../types";
import { countForeignChars } from "./analysis";

// Khớp đúng hậu tố " (số)" ở CUỐI tên/tiêu đề — đây là format do splitLargeChapter()
// (xem chapterSplitter.ts) sinh ra cho cả `file.name` lẫn dòng tiêu đề đầu tiên của
// `content`/`translatedContent`: `${titleLine} (${partNumber})`.
const SPLIT_SUFFIX_REGEX = /\s*\((\d+)\)\s*$/;

interface SplitPartInfo {
    file: FileItem;
    baseName: string;
    partNumber: number;
}

// Trả về null nếu tên file KHÔNG khớp format "<base> (<số>)".
const parseSplitPartName = (file: FileItem): SplitPartInfo | null => {
    const extension = file.name.includes('.') ? file.name.split('.').pop() : undefined;
    const nameNoExt = extension ? file.name.replace(/\.[^/.]+$/, "") : file.name;
    const match = nameNoExt.match(SPLIT_SUFFIX_REGEX);
    if (!match) return null;
    const baseName = nameNoExt.slice(0, match.index).trim();
    if (!baseName) return null;
    return { file, baseName, partNumber: parseInt(match[1], 10) };
};

// Nhóm các file đang chọn có được coi là các phần bị tách ra từ CÙNG 1 chương hay
// không: tất cả tên file phải khớp format "<base> (N)" và có chung <base>. Không yêu
// cầu bắt buộc chọn đủ hết/liên tục — người dùng có thể chỉ gộp lại 1 phần trong số đó.
export const detectSplitChapterGroup = (files: FileItem[]): SplitPartInfo[] | null => {
    if (files.length < 2) return null;
    const parsed = files.map(parseSplitPartName);
    if (parsed.some(p => p === null)) return null;
    const infos = parsed as SplitPartInfo[];
    const firstBase = infos[0].baseName.toLowerCase();
    if (!infos.every(p => p.baseName.toLowerCase() === firstBase)) return null;
    return infos;
};

// Quét TOÀN BỘ danh sách file, tự động tìm và nhóm các file thuộc cùng 1 chương bị
// tách (cùng <base>, cách nhau chỉ bởi hậu tố " (N)"). Trả về danh sách các nhóm >= 2
// phần — dùng cho chế độ "Gộp File" tự động (không cần người dùng tự chọn tay).
export const findAllSplitChapterGroups = (files: FileItem[]): SplitPartInfo[][] => {
    const byBase = new Map<string, SplitPartInfo[]>();
    files.forEach(file => {
        const info = parseSplitPartName(file);
        if (!info) return;
        const key = info.baseName.toLowerCase();
        if (!byBase.has(key)) byBase.set(key, []);
        byBase.get(key)!.push(info);
    });
    return Array.from(byBase.values()).filter(group => group.length >= 2);
};


export const stripSplitSuffix = (text: string): string => text.replace(SPLIT_SUFFIX_REGEX, '').trim();

// Tách 1 phần nội dung đã tách chương thành {title, body}, theo đúng cấu trúc mà
// splitLargeChapter() đã dựng: dòng đầu là tiêu đề, dòng 2 trống, còn lại là nội dung.
const splitTitleAndBody = (content: string): { title: string; body: string } => {
    const lines = content.split('\n');
    const title = (lines[0] || '').trim();
    // Bỏ 1 dòng trống ngay sau tiêu đề nếu có (đúng như lúc tách ra).
    const bodyStart = lines[1] !== undefined && lines[1].trim() === '' ? 2 : 1;
    const body = lines.slice(bodyStart).join('\n').trim();
    return { title, body };
};

// Gộp lại các phần y hệt như trước khi bị tách: 1 tiêu đề chương duy nhất (đã bỏ hậu
// tố số thứ tự), nội dung nối liền mạch bằng dòng trống (KHÔNG chèn dấu phân cách
// "====" như hàm gộp file thông thường, vì bản chất đây là 1 chương liền mạch bị cắt).
export const mergeSplitChapterGroup = (infos: SplitPartInfo[]): FileItem => {
    const sorted = [...infos].sort((a, b) => a.partNumber - b.partNumber);
    const firstFile = sorted[0].file;

    const extension = firstFile.name.includes('.') ? firstFile.name.split('.').pop() : undefined;
    const nameNoExt = extension ? firstFile.name.replace(/\.[^/.]+$/, "") : firstFile.name;
    const cleanBaseName = stripSplitSuffix(nameNoExt);
    const newName = extension ? `${cleanBaseName}.${extension}` : cleanBaseName;

    const mergeField = (getField: (f: FileItem) => string | null): string | null => {
        if (sorted.some(p => !getField(p.file))) return null;
        const parts = sorted.map(p => splitTitleAndBody(getField(p.file) as string));
        const cleanTitle = stripSplitSuffix(parts[0].title);
        const mergedBody = parts.map(p => p.body).filter(Boolean).join('\n\n');
        return `${cleanTitle}\n\n${mergedBody}`;
    };

    const mergedContent = mergeField(f => f.content) ?? sorted.map(p => p.file.content).join('\n\n');
    const mergedTranslated = mergeField(f => f.translatedContent);
    const allTranslated = sorted.every(p => p.file.translatedContent && p.file.status === FileStatus.COMPLETED);

    return {
        ...firstFile,
        id: crypto.randomUUID(),
        name: newName,
        content: mergedContent,
        translatedContent: mergedTranslated,
        status: allTranslated && mergedTranslated ? FileStatus.COMPLETED : FileStatus.IDLE,
        originalCharCount: mergedContent.length,
        remainingRawCharCount: allTranslated && mergedTranslated ? countForeignChars(mergedTranslated) : countForeignChars(mergedContent),
        errorMessage: null,
        usedModel: null,
        retryCount: 0,
        processingDuration: 0,
        // FIX (bug "file đã dịch xong vẫn bị xếp vào diện cứu hộ"): `...firstFile` phía trên có
        // thể mang theo `isRescueLocked: true` nếu phần đầu tiên từng bị khoá cứu hộ - khi gộp
        // xong mà xác định COMPLETED (đã dịch đủ), cờ khoá cũ vẫn dính lại do bị spread nguyên
        // vẹn. Tính lại rõ ràng theo status cuối cùng, không kế thừa mù quáng từ firstFile.
        isRescueLocked: allTranslated && mergedTranslated ? false : firstFile.isRescueLocked,
    };
};
