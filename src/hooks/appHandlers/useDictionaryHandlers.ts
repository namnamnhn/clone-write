// Dictionary-driven find/replace across translated files: applying the
// glossary as literal substitutions, plus the generic find/replace engine
// it's built on. Split out of the old monolithic `useAppHandlers.ts`.
import { FileItem, FileStatus } from '../../types';
import { countForeignChars } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useDictionaryHandlers = (core: CoreApi, ui: UIApi) => {
    // NÂNG CẤP #8 — TỪ ĐIỂN TỰ HỌC: mỗi lần Find/Replace áp dụng thành công, các cặp
    // literal (không phải regex) hợp lệ được tự động ghi bổ sung vào từ điển bổ sung —
    // để lần dịch sau AI biết mà dịch đúng ngay từ đầu, không cần sửa tay lặp lại.
    // Chỉ học cặp ngắn (key <= 60 ký tự), bỏ qua key đã tồn tại (so sánh không phân biệt hoa/thường).
    const learnPairsToDictionary = (pairs: { find?: string, replace?: string, useRegex?: boolean }[]): string[] => {
        const learned: string[] = [];
        try {
            const existing = core.additionalDictionary || '';
            const existingKeys = new Set<string>(
                existing.split('\n')
                    .filter((l: string) => l.includes('=') && !l.trim().startsWith('#') && !l.trim().startsWith('//'))
                    .map((l: string) => l.split('=')[0].trim().replace(/^\[|\]$/g, '').toLowerCase())
            );
            for (const p of pairs) {
                if (p.useRegex) continue;
                const find = (p.find || '').trim();
                const replace = (p.replace || '').trim();
                if (!find || !replace || find.length > 60) continue;
                if (existingKeys.has(find.toLowerCase())) continue;
                existingKeys.add(find.toLowerCase());
                learned.push(`[${find}] = ${replace}`);
            }
            if (learned.length > 0) {
                const base = existing.endsWith('\n') || !existing ? existing : existing + '\n';
                core.setAdditionalDictionary(base + learned.join('\n'));
                ui.addLog(`📚 Từ điển tự học: Đã thêm ${learned.length} cặp từ Find/Replace (${learned.slice(0, 3).join(', ')}${learned.length > 3 ? '...' : ''}).`, 'info');
            }
        } catch {
            // Tự học là tối ưu hoá — bất cứ lỗi gì cũng không được phá vỡ luồng thay thế chính.
        }
        return learned;
    };

    const handleDictionaryEnforce = () => {
        if (!core.additionalDictionary) {
             ui.addToast("Từ điển trống", 'warning');
             return;
        }
        
        const lines = core.additionalDictionary.split('\n');
        const pairs = lines.map((line: string) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || !trimmed.includes('=')) return null;
            const parts = line.split('=');
            const key = parts[0].trim().replace(/^\[|\]$/g, '');
            const value = parts.slice(1).join('=').trim();
            if (!key) return null;
            return {
                find: key,
                replace: value,
                useRegex: false
            };
        }).filter((p: any): p is {find: string, replace: string, useRegex: boolean} => p !== null);
        
        if (pairs.length === 0) {
             ui.addToast("Không tìm thấy từ vựng hợp lệ để áp dụng", 'warning');
             return;
        }
        
        const scope = ui.selectedFiles.size > 0 ? 'selected' : 'all';
        handleFindReplace(pairs, scope);
    };

    const handleFindReplace = (pairs: {find: string, replace: string, useRegex?: boolean, exactMatch?: boolean}[], scope: 'all' | 'selected') => {
        let count = 0;
        const targetIds = scope === 'selected' ? ui.selectedFiles : new Set(core.files.map((f: FileItem) => f.id));
        
        // Pre-compile regexes to avoid recompiling for every file and catch errors early
        const compiledPairs = pairs.map(p => {
            if (p.useRegex && p.find) {
                try {
                    return { ...p, regex: new RegExp(p.find, 'g') };
                } catch (e: any) {
                    ui.addToast(`Regex không hợp lệ: ${p.find} (${e.message})`, 'error');
                    return null;
                }
            } else if (p.find) {
                // If it's a fixed string match, build a robust regex
                const escaped = p.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');
                let patternRegex;
                if (p.exactMatch !== false) {
                     // Exact word boundary matching for Vietnamese/Unicode
                     patternRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${robustSpaceEscaped})(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
                } else {
                     patternRegex = new RegExp(robustSpaceEscaped, 'g');
                }
                return { ...p, regex: patternRegex, isStringExact: p.exactMatch !== false };
            }
            return p;
        }).filter((p: any): p is (typeof pairs[0] & { regex?: RegExp, isStringExact?: boolean }) => p !== null);

        if (compiledPairs.length === 0 && pairs.length > 0) return; // All regexes failed

        const newFiles = core.files.map((f: FileItem) => {
            if (!targetIds.has(f.id)) return f;
            // Target translated content only
            if (f.translatedContent) {
                let newText = f.translatedContent;
                let changed = false;
                compiledPairs.forEach(p => {
                    // FIX: luôn dùng callback trả chuỗi literal thay vì truyền p.replace thẳng
                    // vào replace() - nếu không, các ký tự đặc biệt $&, $', $1... trong chuỗi
                    // thay thế (rất dễ gặp khi sửa dialogue) bị JS diễn giải thành pattern,
                    // chèn/nhân bản nội dung sai hàng loạt.
                    if (p.regex && p.useRegex) {
                        const nextText = newText.replace(p.regex, () => p.replace);
                        if (nextText !== newText) {
                            newText = nextText;
                            changed = true;
                        }
                    } else if (p.regex) {
                        const nextText = p.isStringExact
                            ? newText.replace(p.regex, (match: string, p1: string) => p1 + p.replace)
                            : newText.replace(p.regex, () => p.replace);
                        if (nextText !== newText) {
                            newText = nextText;
                            changed = true;
                        }
                    }
                });
                
                if (changed) {
                    count++;
                    const newRawCount = countForeignChars(newText);
                    return { ...f, translatedContent: newText, remainingRawCharCount: newRawCount, status: FileStatus.COMPLETED, isRescueLocked: false, rawFixAttemptCount: 0 };
                }
            }
            return f;
        });
        
        if (count > 0) {
            core.setFiles(newFiles);
            const learned = learnPairsToDictionary(pairs);
            ui.addToast(learned.length > 0
                ? `Đã thay thế nội dung trong ${count} file (+${learned.length} cặp mới vào từ điển)`
                : `Đã thay thế nội dung trong ${count} file`, 'success');
        } else {
            ui.addToast("Không tìm thấy nội dung cần thay thế", 'info');
        }
    };

    const handleFindReplaceInFile = (fileId: string, find: string, replace: string, exactMatch: boolean = true) => {
        if (!find) return;
        core.setFiles((prev: FileItem[]) => prev.map(f => {
            if (f.id === fileId && f.translatedContent) {
                const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');
                let regex;
                if (exactMatch) {
                    regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${robustSpaceEscaped})(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
                } else {
                    regex = new RegExp(robustSpaceEscaped, 'g');
                }
                
                const newContent = exactMatch
                    ? f.translatedContent.replace(regex, (match: string, p1: string) => p1 + replace)
                    : f.translatedContent.replace(regex, () => replace);
                if (newContent !== f.translatedContent) {
                    const newRawCount = countForeignChars(newContent);
                    learnPairsToDictionary([{ find, replace }]);
                    ui.addToast("Đã thay thế tất cả", "success");
                    return { ...f, translatedContent: newContent, remainingRawCharCount: newRawCount, status: FileStatus.COMPLETED, isRescueLocked: false, rawFixAttemptCount: 0 };
                }
            }
            return f;
        }));
    };

    return { handleDictionaryEnforce, handleFindReplace, handleFindReplaceInFile };
};
