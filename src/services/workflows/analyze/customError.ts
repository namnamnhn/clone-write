// Phân tích 1 lỗi cụ thể do người dùng báo cáo (dùng cho luồng Sửa Lỗi Tuỳ Chỉnh).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';

export const analyzeCustomError = async (
    sampleText: string,
    userPrompt: string,
    enabledModels?: string[],
    imageBase64?: string
): Promise<string> => {
    const candidates = ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
    if (candidates.length === 0) candidates.push('gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');

    const systemInstruction = `Bạn là một Chuyên gia Biên tập và Sửa lỗi văn học.
Nhiệm vụ của bạn là PHÂN TÍCH yêu cầu sửa lỗi của người dùng và đề xuất HƯỚNG GIẢI QUYẾT rõ ràng.

[Dữ liệu đầu vào]:
1. Yêu cầu của người dùng.
2. Một đoạn văn bản mẫu để bạn nắm ngữ cảnh.
3. Ảnh minh họa lỗi (Nếu có).

[Đầu ra mong đợi]:
- Nêu rõ vấn đề/lỗi là gì.
- Phân tích và chỉ ra các biến thể của lỗi (ví dụ: nếu sai tên, hãy lường trước các cụm liên quan như họ, tên lót, biệt danh, v.v.).
- Đề xuất CHÍNH XÁC những gì cần "Tìm" và "Thay thế thành gì".
- TRẢ VỀ dạng văn bản rõ ràng (Bullet points) để người dùng đọc hiểu và có thể CHỈNH SỬA LẠI VÀ LÀM PROMPT TRỰC TIẾP cho hệ thống.
- KHÔNG CẦN CHÀO HỎI, đi thẳng vào phân tích và liệt kê.`;

    const textPrompt = `YÊU CẦU SỬA LỖI TỪ NGƯỜI DÙNG:
"${userPrompt}"

HÃY PHÂN TÍCH DỰA TRÊN ĐOẠN VĂN BẢN MẪU DƯỚI ĐÂY:
${sampleText.substring(0, 80000)}`;

    const contents: any = { parts: [] };
    if (imageBase64) {
        const match = imageBase64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
        if (match) {
            contents.parts.push({
                inlineData: {
                    mimeType: match[1],
                    data: match[3]
                }
            });
        } else {
             const fallbackMatch = imageBase64.match(/^data:(.*?);base64,(.+)$/);
             if (fallbackMatch) {
                 contents.parts.push({
                    inlineData: {
                        mimeType: fallbackMatch[1],
                        data: fallbackMatch[2]
                    }
                });
             }
        }
    }
    contents.parts.push({ text: textPrompt });

    try {
        const ai = getAiClient();
        return await smartExecution(candidates, async (modelId) => {
            const response = await ai.models.generateContent({
                model: modelId,
                contents: contents,
                config: { systemInstruction, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 },
            });
            return response.text?.trim() || "Không thể phân tích, AI trả về kết quả rỗng.";
        }, "Phân tích yêu cầu sửa lỗi");
    } catch (e: any) {
        console.error("Lỗi khi phân tích lỗi:", e);
        return `Đã xảy ra lỗi khi phân tích: ${e.message || 'Lỗi không xác định'}. Bạn có thể bỏ qua bước này và thực hiện sửa lỗi trực tiếp.`;
    }
};
