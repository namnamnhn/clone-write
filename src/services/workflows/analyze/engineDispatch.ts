// Helper dùng chung cho các bước PHÂN TÍCH (Auto Phân Tích Nhanh, Thiết Kế Prompt...) khi
// người dùng chọn Engine = DeepSeek thay vì Gemini ở Thiết Lập Tự Động Hóa.
//
// Cơ chế fallback: nhận vào 1 chuỗi model đã chọn dạng "model_chinh,model_du_phong" (đúng
// định dạng core.deepseekModel đang dùng ở mọi nơi khác trong app), gọi tuần tự — model đầu
// lỗi thì tự động thử model kế tiếp trong danh sách, giống hệt cơ chế "vệ tinh" của
// smartExecution (gemini.ts) dành cho luồng dịch/auto-fix/smart-fix.
import { fetchDeepSeek } from '../../api/deepseek';

export type AnalysisEngine = 'gemini' | 'deepseek';

export const runDeepSeekWithFallback = async (
    deepseekKey: string,
    deepseekModel: string,
    systemInstruction: string,
    prompt: string,
    jsonMode: boolean,
    onLog?: (msg: string) => void
): Promise<string> => {
    const parsed = (deepseekModel || 'deepseek-v4-flash').split(',').map(s => s.trim()).filter(Boolean);
    const ordered = parsed.length > 0 ? parsed : ['deepseek-v4-flash'];

    let lastError: any = null;
    for (let i = 0; i < ordered.length; i++) {
        const modelId = ordered[i];
        try {
            return await fetchDeepSeek(deepseekKey, modelId, systemInstruction, prompt, jsonMode);
        } catch (e: any) {
            lastError = e;
            if (onLog) {
                const hasNext = i < ordered.length - 1;
                onLog(hasNext
                    ? `⚠️ DeepSeek model ${modelId} lỗi (${e?.message || e}). Chuyển sang model dự phòng: ${ordered[i + 1]}...`
                    : `⚠️ DeepSeek model ${modelId} lỗi (${e?.message || e}). Đã hết model dự phòng để thử.`);
            }
        }
    }
    throw lastError || new Error("DeepSeek: Tất cả model đã thử đều lỗi.");
};
