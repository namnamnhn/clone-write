// TÁI CẤU TRÚC: tách parse/serialize từ điển glossary khỏi GlossaryTable.tsx để có thể
// viết test hồi quy thuần túy (không phải mount component React).
export interface GlossaryEntry {
    id: string;
    key: string;
    value: string;
    isComment: boolean;
    conflict?: string;
}

export const parseGlossary = (raw: string): GlossaryEntry[] => {
    const lines = (raw || "").split('\n');
    return lines.map(line => {
        const isComment = line.trim().startsWith('#') || line.trim().startsWith('//') || !line.includes('=');
        let key = '', value = '';
        if (!isComment) {
            const parts = line.split('=');
            key = parts[0].trim().replace(/^\[|\]$/g, '');
            value = parts.slice(1).join('=').trim();
        }
        return {
            id: crypto.randomUUID(),
            key: isComment ? line : key,
            value: isComment ? '' : value,
            isComment
        };
    });
};

export const serializeGlossary = (list: GlossaryEntry[]): string =>
    list.map(e => e.isComment ? e.key : `[${e.key}] = ${e.value}`).join('\n');
