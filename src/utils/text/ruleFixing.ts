import { FileItem } from '../../types';

// ============================================================================
// Module dùng chung cho các trang "Sửa Lỗi" (PromptFixPage) và "Hán Việt"
// (SinoVietnameseFixerPage). Trước đây logic parse/áp rule bị lặp y hệt ở cả 2
// nơi (4 chỗ tổng cộng) — gộp lại đây để sửa 1 lần, áp dụng đồng bộ 2 nơi, và
// để hỗ trợ luồng "xem trước rồi mới áp dụng" (preview/confirm) + phân loại độ
// tin cậy của từng rule theo tần suất xuất hiện trong lỗi thô.
// ============================================================================

export interface FixRule {
    wrong: string;
    right: string;
}

export interface PreviewFixRule extends FixRule {
    id: string;
    /** Số lần cụm "wrong" xuất hiện trong các dòng lỗi thô — tín hiệu tin cậy nhẹ:
     * rule chỉ suy ra từ 1 dòng lỗi thô rất dễ là do model tự khái quát hoá quá đà. */
    freqInRaw: number;
    confidence: 'high' | 'low';
    /** Đếm thử (dry-run) số vị trí rule này sẽ khớp trong dữ liệu thật, KHÔNG ghi đè gì. */
    matchCount: number;
    /** Có được chọn áp dụng hay không (mặc định: tin cậy cao + có khớp vị trí thật). */
    enabled: boolean;
}

export interface ApplyResult {
    newFiles: FileItem[];
    totalOccurrences: number;
    filesAffected: number;
}

const DELIMITERS = ['->', '→', '=>', '='];

/** Parse các dòng dạng "Sai -> Đúng" / "Sai = Đúng" thành danh sách rule. */
export function parseRulesFromText(rulesText: string): FixRule[] {
    const rules: FixRule[] = [];
    (rulesText || '').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const cleanedLine = trimmed.replace(/^[-*\s\d.]+\s*/, '');
        if (!cleanedLine) return;

        let delimiter = '';
        let index = -1;
        for (const delim of DELIMITERS) {
            const idx = cleanedLine.indexOf(delim);
            if (idx !== -1) { delimiter = delim; index = idx; break; }
        }
        if (index === -1) return;

        let wrong = cleanedLine.slice(0, index).trim();
        let right = cleanedLine.slice(index + delimiter.length).trim();
        right = right.replace(/\s*[\(\[].*$/, '').trim();

        wrong = wrong.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();
        right = right.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();

        wrong = wrong.replace(/\\n/g, '\n');
        right = right.replace(/\\n/g, '\n');

        // Chuẩn hóa Unicode NFC — xem giải thích chi tiết trong AI_FIX_LOG.md (fix10):
        // chữ Việt có dấu do AI trả về đôi khi ở dạng NFD (tổ hợp nhiều code point)
        // khác dạng NFC dựng sẵn trong file gốc, nhìn giống hệt nhưng regex không khớp.
        wrong = wrong.normalize('NFC');
        right = right.normalize('NFC');

        if (wrong && wrong !== right) rules.push({ wrong, right });
    });
    return rules;
}

/** Regex biên từ giống hệt logic áp dụng thật — dùng chung để preview và apply luôn khớp nhau. */
export function buildRuleRegex(wrong: string): RegExp {
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');

    const firstChar = wrong[0];
    const lastChar = wrong[wrong.length - 1];
    const isFirstLetter = /\p{L}/u.test(firstChar);
    const isLastLetter = /\p{L}/u.test(lastChar);

    const leftBoundary = isFirstLetter ? `(^|[^\\p{L}\\p{N}_])` : `()`;
    const rightBoundary = isLastLetter ? `(?=[^\\p{L}\\p{N}_]|$)` : ``;
    return new RegExp(`${leftBoundary}(${robustSpaceEscaped})${rightBoundary}`, 'gu');
}

/** Đếm số dòng lỗi thô độc lập có nhắc tới cụm "wrong" — tín hiệu tin cậy. */
export function countFrequencyInRaw(wrong: string, rawLines: string[]): number {
    if (!wrong) return 0;
    const needle = wrong.toLowerCase();
    let count = 0;
    for (const line of rawLines) {
        if (line.toLowerCase().includes(needle)) count++;
    }
    return count;
}

/** Đếm thử (KHÔNG mutate) số vị trí rule sẽ khớp trong toàn bộ file hiện có. */
export function countMatchesInFiles(wrong: string, files: FileItem[]): number {
    let total = 0;
    try {
        const regex = buildRuleRegex(wrong);
        for (const file of files) {
            const text = (file.translatedContent || file.content) as string | undefined;
            if (!text) continue;
            const matches = text.normalize('NFC').match(regex);
            if (matches) total += matches.length;
        }
    } catch {
        // Rule sinh ra regex lỗi (hiếm, ký tự đặc biệt bất thường) -> coi như 0 khớp,
        // để người dùng tự thấy rule này bất ổn ở bước preview thay vì crash cả trang.
        return 0;
    }
    return total;
}

/**
 * Dựng danh sách preview đầy đủ: parse rule (sắp xếp dài->ngắn giống lúc áp dụng
 * thật), tính độ tin cậy theo tần suất trong lỗi thô, đếm thử số vị trí khớp
 * trong dữ liệu thật. KHÔNG đụng gì tới `files` — an toàn gọi nhiều lần.
 */
export function buildRulePreview(rulesText: string, rawText: string, files: FileItem[]): PreviewFixRule[] {
    const rules = parseRulesFromText(rulesText);
    rules.sort((a, b) => b.wrong.length - a.wrong.length);

    const rawLines = (rawText || '').split('\n').map(l => l.trim()).filter(Boolean);

    return rules.map((rule, i) => {
        const freqInRaw = countFrequencyInRaw(rule.wrong, rawLines);
        const matchCount = countMatchesInFiles(rule.wrong, files);
        const confidence: 'high' | 'low' = freqInRaw >= 2 ? 'high' : 'low';
        return {
            ...rule,
            id: `r${i}_${rule.wrong.length}_${matchCount}`,
            freqInRaw,
            matchCount,
            confidence,
            // Mặc định tự chọn: tin cậy cao VÀ thực sự khớp được vị trí nào đó.
            // Rule tin cậy thấp hoặc 0 khớp vẫn hiện ra để người dùng tự quyết, không ẩn đi.
            enabled: confidence === 'high' && matchCount > 0,
        };
    });
}

/** Chia văn bản danh sách rule (mỗi dòng 1 rule) thành nhiều lô tối đa `maxLines`
 * dòng/lô — dùng cho bước hậu kiểm Flash khi số rule quá lớn để gửi trong 1 lần
 * gọi (tránh vượt giới hạn token đầu vào, giữ đúng tinh thần "hậu kiểm nhẹ"). */
export function chunkRuleLines(rulesText: string, maxLines: number = 300): string[] {
    const lines = (rulesText || '').split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join('\n'));
    }
    return chunks;
}

export async function applyRulesToFiles(
    files: FileItem[],
    rules: FixRule[],
    opts?: { onProgress?: (msg: string) => void; maxRulesPerBatch?: number; batchSize?: number }
): Promise<ApplyResult> {
    const MAX_RULES = opts?.maxRulesPerBatch ?? 500;
    const BATCH_SIZE = opts?.batchSize ?? 15;

    const totalFilesAffected = new Set<number>();
    let totalOccurrences = 0;
    const newFiles = [...files];

    for (let r = 0; r < rules.length; r += MAX_RULES) {
        const activeRules = rules.slice(r, r + MAX_RULES);
        const ruleBatchNum = Math.floor(r / MAX_RULES) + 1;
        const totalRuleBatches = Math.ceil(rules.length / MAX_RULES);

        if (totalRuleBatches > 1) {
            opts?.onProgress?.(`Đang áp dụng lô quy tắc ${ruleBatchNum}/${totalRuleBatches} (${activeRules.length} quy tắc)...`);
        }

        for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
            const chunk = newFiles.slice(i, i + BATCH_SIZE);

            if (totalRuleBatches === 1) {
                opts?.onProgress?.(`Đang xử lý lô chương ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newFiles.length / BATCH_SIZE)} (Chương ${i + 1} - ${Math.min(i + BATCH_SIZE, newFiles.length)})...`);
            } else if (i % (BATCH_SIZE * 4) === 0) {
                opts?.onProgress?.(`[Lô QT ${ruleBatchNum}/${totalRuleBatches}] Quét từ chương ${i + 1}/${newFiles.length}...`);
            }

            chunk.forEach((file, relativeIndex) => {
                const idx = i + relativeIndex;
                if (!file.translatedContent && !file.content) return;
                let text = ((file.translatedContent || file.content) as string).normalize('NFC');
                let fileChanged = false;

                activeRules.forEach(rule => {
                    const regex = buildRuleRegex(rule.wrong);
                    let changed = false;
                    let matchCount = 0;
                    const nextText = text.replace(regex, (_match, prefix) => {
                        changed = true;
                        matchCount++;
                        return prefix + rule.right;
                    });
                    if (changed) {
                        totalOccurrences += matchCount;
                        text = nextText;
                        fileChanged = true;
                    }
                });

                if (fileChanged) {
                    totalFilesAffected.add(idx);
                    newFiles[idx] = { ...file };
                    if (newFiles[idx].translatedContent) newFiles[idx].translatedContent = text;
                    else newFiles[idx].content = text;
                }
            });

            // Nhường control cho trình duyệt để tránh đứng hình UI
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return { newFiles, totalOccurrences, filesAffected: totalFilesAffected.size };
}
