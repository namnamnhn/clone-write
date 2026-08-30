// NÂNG CẤP #9 — HEALTH-CHECK API THỐNG NHẤT
// Kiểm tra nhanh "còn sống" của cả 2 nhà cung cấp trong 1 lần bấm:
//   - Gemini : gọi generateContent "Hi" trên model flash-lite đầu tiên còn bật
//   - DeepSeek   : kiểm tra TỪNG key (mask) với model đầu tiên đã chọn
// Trả về danh sách kết quả để UI hiển thị dạng bảng; KHÔNG throw — mỗi mục tự bắt lỗi.
import { getAiClient, SAFETY_SETTINGS } from './gemini';

export interface ApiHealthResult {
    name: string;
    ok: boolean;
    detail: string;
    latencyMs: number;
}

// fix65 (bảo mật hiển thị): chỉ hiện 4 ký tự CUỐI của key trong nhãn kết quả chẩn đoán
// (trước đây giữ 8 ký tự đầu — lộ gần nửa key trên màn hình/log).
const maskKey = (key: string): string =>
    key.length > 12 ? '••••••' + key.substring(key.length - 4) : 'Invalid Key';

const splitKeys = (raw?: string): string[] =>
    (raw || '').split(/[,\n]/).map(k => k.trim()).filter(Boolean);

export const runApiHealthCheck = async (cfg: {
    enabledModels: string[];
    deepseekKeys?: string;
    deepseekModel?: string;
}): Promise<ApiHealthResult[]> => {
    const results: ApiHealthResult[] = [];

    // --- GEMINI ---
    {
        const preferred = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash'];
        const model = preferred.find(m => cfg.enabledModels.includes(m)) || cfg.enabledModels.find(m => m.startsWith('gemini')) || 'gemini-3.5-flash-lite';
        const t0 = Date.now();
        try {
            const ai = getAiClient();
            await ai.models.generateContent({
                model,
                contents: 'Hi',
                config: { maxOutputTokens: 5, safetySettings: SAFETY_SETTINGS }
            });
            results.push({ name: `Gemini (${model})`, ok: true, detail: 'Kết nối tốt', latencyMs: Date.now() - t0 });
        } catch (e: any) {
            const msg = (e?.message || String(e)).toLowerCase();
            let detail = e?.message || 'Lỗi không xác định';
            if (msg.includes('quota') || msg.includes('exhausted') || msg.includes('429')) detail = 'Hết quota / rate-limit';
            else if (msg.includes('api key not valid') || msg.includes('api_key_invalid')) detail = 'API Key không hợp lệ';
            else if (msg.includes('failed to fetch') || msg.includes('network')) detail = 'Lỗi mạng';
            results.push({ name: `Gemini (${model})`, ok: false, detail, latencyMs: Date.now() - t0 });
        }
    }

    // --- DEEPSEEK (từng key) ---
    {
        const dsKeys = splitKeys(cfg.deepseekKeys);
        const model = (cfg.deepseekModel || 'deepseek-v4-flash').split(',')[0].trim() || 'deepseek-v4-flash';
        if (dsKeys.length === 0) {
            results.push({ name: 'DeepSeek', ok: false, detail: 'Chưa cấu hình key (bình thường nếu không dùng)', latencyMs: 0 });
        } else {
            for (let i = 0; i < dsKeys.length; i++) {
                const t0 = Date.now();
                const label = `DeepSeek #${i + 1} (${maskKey(dsKeys[i])})`;
                try {
                    const res = await fetch('https://api.deepseek.com/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${dsKeys[i]}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
                    });
                    if (!res.ok) {
                        const errObj = await res.json().catch(() => ({}));
                        results.push({ name: label, ok: false, detail: errObj?.error?.message || `HTTP ${res.status}`, latencyMs: Date.now() - t0 });
                    } else {
                        results.push({ name: label, ok: true, detail: `OK qua ${model}`, latencyMs: Date.now() - t0 });
                    }
                } catch (e: any) {
                    results.push({ name: label, ok: false, detail: e?.message || 'Lỗi mạng', latencyMs: Date.now() - t0 });
                }
            }
        }
    }

    return results;
};
