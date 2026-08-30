import { FileItem } from '../../../types';
import { NON_STORY_SKIP_CONFIDENCE, SHORT_FILE_CLASSIFIER_POLICY, SHORT_RAW_CLASSIFICATION_BATCH_SIZE, SHORT_RAW_FILE_MAX_CHARS, fingerprintShortRawContent } from '../../../utils/text/nonStoryPolicy';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../../api/gemini';

export type ShortFileClassificationKind = 'story' | 'non_story' | 'uncertain';
export interface ShortFileClassification { id: string; kind: ShortFileClassificationKind; confidence: number; reason: string; }

const CLASSIFIER_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
const clampConfidence = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
};

export function parseShortFileClassifications(raw: string, expectedIds: string[]): Map<string, ShortFileClassification> {
    const result = new Map<string, ShortFileClassification>();
    let parsed: any;
    try { parsed = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim()); } catch { return result; }
    const expected = new Set(expectedIds);
    for (const row of Array.isArray(parsed?.files) ? parsed.files : []) {
        const id = typeof row?.id === 'string' ? row.id : '';
        if (!expected.has(id)) continue;
        const rawKind = String(row?.kind || '').toLowerCase();
        const kind: ShortFileClassificationKind = rawKind === 'non_story' ? 'non_story' : rawKind === 'story' ? 'story' : 'uncertain';
        const confidence = clampConfidence(row?.confidence);
        result.set(id, { id, kind: kind === 'non_story' && confidence < NON_STORY_SKIP_CONFIDENCE ? 'uncertain' : kind, confidence, reason: String(row?.reason || '').trim().substring(0, 240) });
    }
    return result;
}

const buildPrompt = (files: FileItem[]): string => `Bạn là bộ phân loại bảo toàn nội dung truyện. Hãy xác định từng file raw ngắn có phải TOÀN BỘ chỉ là lời ngoài truyện hay vẫn có nội dung cần dịch.

${SHORT_FILE_CLASSIFIER_POLICY}

Trả đúng JSON, không thêm văn bản ngoài JSON:
{"files":[{"id":"file_id","kind":"story|non_story|uncertain","confidence":0.0,"reason":"lý do ngắn"}]}

${files.map(file => `--- FILE ${file.id} | ${file.name} ---\n${file.content}`).join('\n\n')}`;

export async function classifyShortRawFiles(files: FileItem[], enabledModels: string[], onLog?: (message: string) => void): Promise<Map<string, ShortFileClassification>> {
    const candidates = CLASSIFIER_MODELS.filter(id => enabledModels.includes(id) || enabledModels.length === 0);
    const eligible = files.filter(file => file.content.trim().length > 0 && file.content.length < SHORT_RAW_FILE_MAX_CHARS);
    const combined = new Map<string, ShortFileClassification>();
    if (eligible.length === 0 || candidates.length === 0) return combined;
    for (let offset = 0; offset < eligible.length; offset += SHORT_RAW_CLASSIFICATION_BATCH_SIZE) {
        const chunk = eligible.slice(offset, offset + SHORT_RAW_CLASSIFICATION_BATCH_SIZE);
        try {
            const raw = await smartExecution<string>(candidates, async modelId => {
                const ai = getAiClient();
                const response = await ai.models.generateContent({ model: modelId, contents: buildPrompt(chunk), config: { safetySettings: SAFETY_SETTINGS, temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 } });
                return response.text || '{}';
            }, 'Phân loại file raw ngắn', onLog);
            const parsed = parseShortFileClassifications(raw, chunk.map(file => file.id));
            for (const file of chunk) combined.set(file.id, parsed.get(file.id) || { id: file.id, kind: 'uncertain', confidence: 0, reason: 'AI không trả kết luận cho file này.' });
        } catch (error: any) {
            onLog?.(`⚠️ Không phân loại được lô ${chunk.length} file raw ngắn (${error?.message || error}). Giữ nguyên và vẫn dịch để tránh bỏ nhầm nội dung truyện.`);
            for (const file of chunk) combined.set(file.id, { id: file.id, kind: 'uncertain', confidence: 0, reason: 'Lỗi gọi AI; mặc định giữ để dịch.' });
        }
    }
    return combined;
}

export function needsShortFileClassification(file: FileItem): boolean {
    if (!file.content.trim() || file.content.length >= SHORT_RAW_FILE_MAX_CHARS || file.translatedContent) return false;
    return file.shortContentFingerprint !== fingerprintShortRawContent(file.content) || !file.shortContentKind;
}

export function isConfirmedNonStoryFile(file: FileItem): boolean {
    return file.shortContentKind === 'non_story' && file.shortContentConfidence !== undefined && file.shortContentConfidence >= NON_STORY_SKIP_CONFIDENCE && file.shortContentFingerprint === fingerprintShortRawContent(file.content);
}
