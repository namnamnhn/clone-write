// useSmartFix.ts trước đây là 1 hook ~562 dòng gộp chung 3 nhóm chức năng không hoàn toàn
// độc lập (có 1 state "isCustomFixing" dùng chung, và handleSmartFix có gọi thẳng
// handleFixRemainingRaw). Đã tách thành 3 hook con trong ./smartFix/* theo đúng nhóm phụ
// thuộc thực tế:
//   - customErrorFix.ts: sửa lỗi tuỳ chỉnh (giữ state isCustomFixing dùng chung)
//   - smartFixCore.ts:  handleFixRemainingRaw + handleSmartFix (giữ chung vì gọi lẫn nhau)
//   - manualFix.ts:     sửa lỗi thủ công 1 file
//
// Hook này giờ chỉ ghép kết quả 3 hook con lại, giữ NGUYÊN object trả về (cùng tên hàm như
// cũ) nên không cần sửa bất kỳ nơi nào đang dùng useSmartFix().
import { useCustomErrorFix } from './smartFix/customErrorFix';
import { useSmartFixCore } from './smartFix/smartFixCore';
import { useManualFix } from './smartFix/manualFix';
import type { CoreApi, UIApi } from './apiTypes';

export const useSmartFix = (
    core: CoreApi,
    ui: UIApi,
    sharedState: any
) => {
    const customErrorFix = useCustomErrorFix(core, ui, sharedState);
    const smartFixCore = useSmartFixCore(core, ui, sharedState);
    const manualFix = useManualFix(core, ui, sharedState);

    return {
        ...customErrorFix,
        ...smartFixCore,
        ...manualFix,
    };
};
