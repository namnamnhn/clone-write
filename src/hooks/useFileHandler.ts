// useFileHandler.ts trước đây là 1 hook ~677 dòng chứa 17 hàm xử lý file không liên quan
// trực tiếp tới nhau (nhập file, tách chương, dọn dẹp, xuất/tải, backup/restore). Đã tách
// thành 5 hook con trong ./fileHandler/* theo nhóm chức năng để dễ định vị khi cần sửa 1
// loại lỗi cụ thể (vd: lỗi khi import file thì chỉ cần mở fileImport.ts).
//
// Hook này giờ chỉ làm nhiệm vụ GHÉP kết quả của 5 hook con lại, giữ NGUYÊN object trả về
// (cùng tên hàm như cũ) nên không cần sửa bất kỳ nơi nào đang dùng useFileHandler().
import { useFileImport } from './fileHandler/fileImport';
import { useFileSplitting } from './fileHandler/fileSplitting';
import { useFileCleanup } from './fileHandler/fileCleanup';
import { useFileExportDownload } from './fileHandler/fileExportDownload';
import { useFileBackupRestore } from './fileHandler/fileBackupRestore';
import type { CoreApi, UIApi } from './apiTypes';

export const useFileHandler = (
    core: CoreApi,
    ui: UIApi,
    onFilesAdded?: () => void
) => {
    const importHandlers = useFileImport(core, ui, onFilesAdded);
    const splittingHandlers = useFileSplitting(core, ui, onFilesAdded);
    const cleanupHandlers = useFileCleanup(core, ui);
    const exportDownloadHandlers = useFileExportDownload(core, ui);
    const backupRestoreHandlers = useFileBackupRestore(core, ui);

    return {
        ...importHandlers,
        ...splittingHandlers,
        ...cleanupHandlers,
        ...exportDownloadHandlers,
        ...backupRestoreHandlers,
    };
};
