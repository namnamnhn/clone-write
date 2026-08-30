// Các hàm dùng chung nội bộ cho các module trong utils/file/*
// (không export ra ngoài package fileHelpers để giữ nguyên API công khai cũ)
import { formatBookStyle } from '../text';

export const padNumber = (num: number, size: number = 3): string => {
    let s = String(num);
    while (s.length < size) s = "0" + s;
    return s;
};

export const sanitizeFilename = (name: string): string => {
    return name.replace(/[:/\\?%*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
};

export const resolvePath = (base: string, relative: string) => {
    try { relative = decodeURIComponent(relative); } catch { /* ignore */ }
    const parts = base.split('/');
    parts.pop(); // remove filename
    const relParts = relative.split('/');
    for (const p of relParts) {
        if (p === '.') continue;
        if (p === '..') parts.pop();
        else parts.push(p);
    }
    return parts.join('/');
};


export const cleanContentArtifacts = (content: string, enableTitleFormatting: boolean = true, enableAutoFormat: boolean = true): string => {
    if (!content) return "";
    let clean = content;
    clean = clean.replace(/^(?:###)?\s*EPUB_CHAPTER_SPLIT\s*.*$/gim, '');
    clean = clean.replace(/^Part \d+ \(Split\)$/gim, '');
    clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    clean = formatBookStyle(clean, undefined, enableTitleFormatting, 'colon', enableAutoFormat);
    return clean.trim();
};
