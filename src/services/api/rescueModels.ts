// TÁI CẤU TRÚC: gộp logic "chọn model cho tác vụ sửa lỗi/cứu hộ" vốn trùng lặp Y HỆT nhau
// ở smartFixCore.ts (handleFixRemainingRaw) và customErrorFix.ts (handleCustomErrorCorrection):
// nếu batch từng đi qua vệ tinh DeepSeek thì sửa dòng tiếp tục dùng đúng vệ tinh đó
// (tránh dính lại Safety Filter Gemini vừa né được), ngược lại giữ nguyên danh sách Gemini.
// Trước đây phải sửa 2 nơi mỗi khi đổi danh sách fallback - dễ sót một chỗ.

export interface RepairModelConfig {
    enabledModels: string[];
    deepseekKey?: string;
    deepseekModel?: string;
}

/**
 * Chọn danh sách model cho bước repair dựa trên nguồn gốc dịch của các file liên quan.
 * @param filesLike Danh sách file liên quan (chỉ cần field usedModel)
 */
export const pickRepairModels = (
    filesLike: { usedModel?: string | null }[],
    cfg: RepairModelConfig
): string[] => {
    const hasDeepSeekFile = filesLike.some(f => f.usedModel?.startsWith('deepseek:'));
    let models = cfg.enabledModels;
    if (hasDeepSeekFile && cfg.deepseekKey && cfg.deepseekModel) {
        // File này dịch bằng DeepSeek -> autofix dòng sót raw cũng dùng lại DeepSeek để
        // tránh dính lại lỗi Safety Filter Gemini vừa mới cứu hộ né được. Dùng TOÀN BỘ
        // danh sách model đã chọn (chính + dự phòng) để smartExecution tự chuyển model
        // kế tiếp khi model đầu lỗi, thay vì khoá cứng vào đúng 1 model.
        const selectedDs = cfg.deepseekModel.split(',').map(s => s.trim()).filter(Boolean);
        models = (selectedDs.length > 0 ? selectedDs : ['deepseek-v4-flash']).map(m => `deepseek:${m}`);
    }
    return models;
};
