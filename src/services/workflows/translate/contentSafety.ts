// Kiểm tra nội dung có vi phạm chính sách an toàn nội dung của AI hay không (trước khi dịch).

export const testContentSafety = async (content: string, enabledModels: string[]): Promise<{ isSafe: boolean, modelUsed: string }> => {
    try {
        const { getAiClient, SAFETY_SETTINGS } = await import('../../api/gemini');
        const { quotaManager } = await import('../../../utils/quotaManager');
        const ai = getAiClient();
        
        // Use quotaManager to find available flash models to avoid 429 errors

        const priorityModels = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
        const modelsToTry = priorityModels.filter(m => enabledModels.includes(m) || enabledModels.length === 0);
        
        if (modelsToTry.length === 0) {
            const fallback = enabledModels.find(m => m.startsWith('gemini') || m.startsWith('gemma'));
            if (fallback) modelsToTry.push(fallback);
            else modelsToTry.push('gemini-3.5-flash-lite');
        }
        
        // Sort by quota availability but keep priority order if wait times are similar
        modelsToTry.sort((a, b) => {
            const waitA = quotaManager.getWaitTimeForModel(a);
            const waitB = quotaManager.getWaitTimeForModel(b);
            if (waitA === waitB) return 0;
            return waitA - waitB;
        });
        
        const prompt = `Đây là bài test. Chỉ cần trả lời đúng chữ "OK" và không làm gì khác, không cần đọc nội dung đoạn văn bên dưới.\n\n[NỘI DUNG]:\n${content.substring(0, 4000)}`;

        let lastErr: any;
        for (const targetModel of modelsToTry) {
            try {
                // Check if we need to wait
                const wait = quotaManager.getWaitTimeForModel(targetModel);
                if (wait > 0 && wait !== Infinity) {
                    await new Promise(r => setTimeout(r, wait));
                } else if (wait === Infinity) {
                    continue; // Skip depleted models
                }

                console.log("testContentSafety recording request for:", targetModel);
                quotaManager.recordRequest(targetModel);

                await ai.models.generateContent({
                    model: targetModel,
                    contents: prompt,
                    config: { maxOutputTokens: 10, safetySettings: SAFETY_SETTINGS }
                });
                
                console.log("testContentSafety success for:", targetModel);
                quotaManager.recordSuccess(targetModel);
                return { isSafe: true, modelUsed: targetModel }; // Safe
            } catch (err: any) {
                lastErr = err;
                const msg = err.message?.toLowerCase() || '';
                // FIX (so khớp chữ hoa/thường lẫn lộn): msg đã lowercase nhưng các marker
                // BLOCKLIST/PROHIBITED_CONTENT/RECITATION/SPII từng so khớp trên err.message
                // GỐC — lỗi trả về dạng chữ thường ("blocklist") rơi xuống nhánh generic
                // (recordError + break -> fail-open "an toàn" dù thực ra là bị chặn). So khớp
                // thống nhất trên msg đã lowercase.
                if (msg.includes("safety") || msg.includes("bộ lọc") || msg.includes("blocklist") || msg.includes("prohibited_content") || msg.includes("other") || msg.includes("recitation") || msg.includes("spii")) {
                    quotaManager.recordSuccess(targetModel); // API still responded
                    return { isSafe: false, modelUsed: targetModel }; // Not Safe!
                }
                // If it's a quota error, continue to next model
                if (msg.includes("429") || msg.includes("quota") || msg.includes("exhausted")) {
                    quotaManager.recordQuotaError(targetModel);
                    if (msg.includes('per day') || msg.includes('daily')) {
                        quotaManager.markAsDepleted(targetModel);
                    }
                    continue;
                }
                if (msg.includes("trả về nội dung rỗng")) {
                    quotaManager.recordSuccess(targetModel);
                    return { isSafe: true, modelUsed: targetModel }; 
                }
                
                quotaManager.recordError(targetModel);
                // Other errors, break and return false
                break;
            }
        }
        
        // Không model nào xác nhận được kết quả (hết quota hoặc lỗi khác).
        // Vẫn coi là "an toàn" để không chặn oan quy trình dịch (giữ hành vi cũ),
        // nhưng LOG rõ lỗi cuối cùng thay vì nuốt im lặng, và phản ánh đúng lý do vào modelUsed
        // để log/UI không hiển thị nhầm "quota exhausted" khi thực ra là lỗi khác.
        if (lastErr) {
            console.warn("testContentSafety: không xác định được an toàn, mặc định coi là an toàn. Lỗi cuối cùng:", lastErr);
            return { isSafe: true, modelUsed: `unknown (error: ${lastErr.message || String(lastErr)})` };
        }
        return { isSafe: true, modelUsed: "unknown (quota exhausted)" };
    } catch (e: any) {
        console.error("testContentSafety error:", e);
        return { isSafe: true, modelUsed: `error (${e?.message || String(e)})` };
    }
};
