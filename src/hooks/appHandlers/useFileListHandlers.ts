// File-list CRUD and selection: save/merge selected files, select/range-select,
// delete (single/selected/all), and the destructive full-app reset — all the
// confirm-modal-gated list operations. Split out of the old monolithic
// `useAppHandlers.ts` — logic unchanged.
import { FileItem, FileStatus } from '../../types';
import { countForeignChars, detectSplitChapterGroup, mergeSplitChapterGroup, findAllSplitChapterGroups } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useFileListHandlers = (core: CoreApi, ui: UIApi) => {
    const handleSaveSelected = async () => {
        if (ui.selectedFiles.size === 0) {
            ui.addToast("Vui lòng chọn ít nhất 1 file để lưu.", "warning");
            return;
        }
        
        // Mark selected files as COMPLETED so they don't get re-translated (only if they have content)
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
            if (ui.selectedFiles.has(f.id)) {
                if (f.translatedContent && f.translatedContent.trim() !== '') {
                    // FIX (bug "5 tệp đã dịch xong vẫn bị xếp vào diện cứu hộ"): trước đây chỉ xoá
                    // `errorMessage`/`retryCount` mà KHÔNG xoá `isRescueLocked` — nếu người dùng
                    // tự chọn 1 file đang bị khoá cứu hộ (isRescueLocked=true, có thể do hậu kiểm
                    // khởi động từ chối oan) rồi bấm "Lưu Đã Chọn" để xác nhận thủ công là bản dịch
                    // ổn, status chuyển COMPLETED nhưng cờ khoá cứu hộ vẫn còn nguyên — khiến file
                    // vẫn bị đếm/lọc vào nhóm "Cứu hộ (chờ DeepSeek)" dù đã xong thật.
                    // Trạng thái COMPLETED và isRescueLocked=true vốn mâu thuẫn nhau về ý nghĩa -
                    // hễ đã coi là COMPLETED thì phải gỡ khoá cứu hộ, giống đúng quy tắc đã áp
                    // dụng ở luồng dịch chính (useTranslator.ts dòng ~310).
                    return { ...f, status: FileStatus.COMPLETED, errorMessage: undefined, retryCount: 0, isRescueLocked: false };
                } else {
                    return { ...f, status: FileStatus.IDLE, errorMessage: undefined, retryCount: 0 };
                }
            }
            return f;
        }));

        // Wait a tick for state to update before saving
        setTimeout(async () => {
            const success = await core.saveSession(true);
            if (success) {
                ui.addToast(`Đã lưu và cập nhật trạng thái ${ui.selectedFiles.size} file.`, "success");
                ui.setSelectedFiles(new Set()); // Clear selection after save
            } else {
                ui.addToast("Lỗi khi lưu dữ liệu.", "error");
            }
        }, 0);
    };

    const handleMergeSelected = () => {
        // Không chọn file nào -> chế độ TỰ ĐỘNG: quét toàn bộ danh sách, tìm mọi nhóm
        // chương bị "Tách Chương" cắt ra (tên dạng "<tên> (1)", "<tên> (2)"...) và gộp
        // hết 1 lượt — không cần tự tay chọn từng nhóm, đối xứng với việc Tách Chương
        // cũng tự động vậy.
        if (ui.selectedFiles.size === 0) {
            const groups = findAllSplitChapterGroups(core.files);
            if (groups.length === 0) {
                ui.addToast("Không tìm thấy nhóm chương nào bị tách (dạng \"Tên (1)\", \"Tên (2)\"...) để tự động gộp. Hãy chọn file thủ công nếu muốn gộp kiểu khác.", 'warning');
                return;
            }
            const mergedFiles = groups.map(mergeSplitChapterGroup);
            const mergedIds = new Set(groups.flatMap(g => g.map(p => p.file.id)));
            core.setFiles((prev: FileItem[]) => {
                // FIX (UX hiển thị): trước đây append cuối mảng khiến chương gộp xong bị đẩy
                // xuống đáy danh sách Workspace dù nội dung thuộc vị trí cũ. Exporter có sort
                // riêng nên file XUẤT không sai, nhưng hiển thị trong app lệch tới khi sort lại.
                // Giờ chèn tại đúng vị trí của thành viên ĐẦU TIÊN trong nhóm.
                const firstIdx = prev.findIndex((f: FileItem) => mergedIds.has(f.id));
                if (firstIdx < 0) return [...prev.filter((f: FileItem) => !mergedIds.has(f.id)), ...mergedFiles];
                const keptBeforeCount = prev.slice(0, firstIdx).filter((f: FileItem) => !mergedIds.has(f.id)).length;
                const remaining = prev.filter((f: FileItem) => !mergedIds.has(f.id));
                const next = [...remaining];
                next.splice(keptBeforeCount, 0, ...mergedFiles);
                return next;
            });
            ui.addToast(`Đã tự động gộp ${groups.length} chương bị tách (tổng ${mergedIds.size} file) thành ${groups.length} chương hoàn chỉnh.`, 'success');
            ui.setSelectedFiles(new Set(mergedFiles.map(f => f.id)));
            return;
        }

        if (ui.selectedFiles.size < 2) {
            ui.addToast("Chọn ít nhất 2 file để gộp (hoặc bỏ chọn hết để tự động gộp mọi chương bị tách)", 'warning');
            return;
        }
        
        const selected = core.files.filter((f: FileItem) => ui.selectedFiles.has(f.id));
        // Sort by name naturally
        selected.sort((a: FileItem, b: FileItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        // Nếu các file đang chọn đúng là các phần bị "Tách Chương" cắt ra từ 1 chương
        // gốc (tên dạng "<tên> (1)", "<tên> (2)"...) thì gộp lại NGUYÊN VẸN như trước
        // khi tách: 1 tiêu đề chương duy nhất (bỏ hậu tố số), nối liền mạch, không chèn
        // dấu phân cách "====" — để lúc đóng epub gọn gàng, không bị chương ảo (1)(2)(3).
        const splitGroup = detectSplitChapterGroup(selected);
        if (splitGroup) {
            const mergedFile = mergeSplitChapterGroup(splitGroup);
            core.setFiles((prev: FileItem[]) => {
                const firstIdx = prev.findIndex((f: FileItem) => ui.selectedFiles.has(f.id));
                if (firstIdx < 0) return [...prev.filter((f: FileItem) => !ui.selectedFiles.has(f.id)), mergedFile];
                const keptBeforeCount = prev.slice(0, firstIdx).filter((f: FileItem) => !ui.selectedFiles.has(f.id)).length;
                const remaining = prev.filter((f: FileItem) => !ui.selectedFiles.has(f.id));
                const next = [...remaining];
                next.splice(keptBeforeCount, 0, mergedFile);
                return next;
            });
            ui.addToast(`Đã gộp ${selected.length} phần đã tách thành 1 chương hoàn chỉnh: "${mergedFile.name}"`, 'success');
            ui.setSelectedFiles(new Set([mergedFile.id]));
            return;
        }

        const firstFile = selected[0];
        const extension = firstFile.name.split('.').pop();
        const baseName = firstFile.name.replace(/\.[^/.]+$/, "");
        const newName = `${baseName}_Merged.${extension || 'txt'}`;
        
        const mergedContent = selected.map((f: FileItem) => f.content).join('\n\n' + '='.repeat(20) + '\n\n');
        // Only merge translated content if ALL selected files have it
        const allTranslated = selected.every((f: FileItem) => f.translatedContent);
        const mergedTranslated = allTranslated ? selected.map((f: FileItem) => f.translatedContent).join('\n\n' + '='.repeat(20) + '\n\n') : undefined;
        
        const newFile: FileItem = {
            id: crypto.randomUUID(),
            name: newName,
            content: mergedContent,
            originalCharCount: mergedContent.length,
            translatedContent: mergedTranslated,
            status: allTranslated ? FileStatus.COMPLETED : FileStatus.IDLE,
            remainingRawCharCount: allTranslated ? countForeignChars(mergedTranslated!) : countForeignChars(mergedContent),
            errorMessage: null,
            usedModel: null,
            retryCount: 0,
            processingDuration: 0
        };
        
        // Chèn tại vị trí của thành viên đầu tiên được chọn (thay vì append cuối mảng) để
        // danh sách hiển thị không xáo trộn — exporter có sort riêng nên file XUẤT không ảnh hưởng.
        core.setFiles((prev: FileItem[]) => {
            const firstIdx = prev.findIndex((f: FileItem) => ui.selectedFiles.has(f.id));
            if (firstIdx < 0) return [...prev, newFile];
            const next = [...prev];
            next.splice(firstIdx, 0, newFile);
            return next;
        });
        ui.addToast(`Đã gộp ${selected.length} file thành "${newName}"`, 'success');
        
        // Optional: Select the new file
        ui.setSelectedFiles(new Set([newFile.id]));
    };

    const handleRemoveFile = (id: string) => { 
        ui.setConfirmModal({
            isOpen: true,
            title: "Xóa File?",
            message: "Bạn có chắc chắn muốn xóa file này không?",
            isDanger: true,
            confirmText: "Xóa Ngay",
            onConfirm: () => {
                core.setFiles((prev: FileItem[]) => prev.filter(f => f.id !== id)); 
                ui.setSelectedFiles((prev: Set<string>) => { const n = new Set(prev); n.delete(id); return n; }); 
                ui.setLastSelectedId(null);
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã xóa file", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const handleSmartDelete = () => {
        if (ui.selectedFiles.size === 0) return;
        ui.setConfirmModal({
            isOpen: true,
            title: `Xóa ${ui.selectedFiles.size} File?`,
            message: "Hành động này sẽ xóa các file đang chọn khỏi danh sách. Bạn có chắc không?",
            isDanger: true,
            confirmText: "Xóa Tất Cả Chọn",
            onConfirm: () => {
                core.setFiles((prev: FileItem[]) => prev.filter(f => !ui.selectedFiles.has(f.id)));
                ui.setSelectedFiles(new Set());
                ui.setLastSelectedId(null);
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã xóa các file đã chọn", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const requestDeleteAll = () => {
        if (core.files.length === 0) return;
        ui.setConfirmModal({
            isOpen: true,
            title: "Xóa Toàn Bộ?",
            message: "CẢNH BÁO: Hành động này sẽ xóa sạch tất cả các file hiện có. Dữ liệu chưa lưu sẽ bị mất.",
            isDanger: true,
            confirmText: "XÓA HẾT",
            onConfirm: () => {
                core.setFiles([]);
                ui.setSelectedFiles(new Set());
                ui.setLastSelectedId(null);
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã dọn sạch danh sách file", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const requestResetApp = () => {
        ui.setConfirmModal({
            isOpen: true,
            title: "Reset Toàn Bộ App?",
            message: "CẢNH BÁO NGUY HIỂM: Hành động này sẽ xóa sạch toàn bộ dữ liệu, file và cài đặt. Ứng dụng sẽ trở về trạng thái như mới cài đặt. Bạn có chắc chắn muốn tiếp tục?",
            isDanger: true,
            confirmText: "RESET TOÀN BỘ",
            onConfirm: () => {
                core.performSoftReset();
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã reset toàn bộ ứng dụng", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const handleSelectFile = (id: string, shiftKey: boolean) => {
        const newSelected = new Set(ui.selectedFiles);
        if (shiftKey && ui.lastSelectedId && ui.lastSelectedId !== id) {
            const idx1 = core.files.findIndex((f: FileItem) => f.id === ui.lastSelectedId);
            const idx2 = core.files.findIndex((f: FileItem) => f.id === id);
            if (idx1 !== -1 && idx2 !== -1) {
                const start = Math.min(idx1, idx2);
                const end = Math.max(idx1, idx2);
                for (let i = start; i <= end; i++) newSelected.add(core.files[i].id);
                ui.setSelectedFiles(newSelected);
                return;
            }
        }
        if (newSelected.has(id)) newSelected.delete(id); else newSelected.add(id);
        ui.setLastSelectedId(id);
        ui.setSelectedFiles(newSelected);
    };

    const selectAll = () => { if (ui.selectedFiles.size === core.files.length) ui.setSelectedFiles(new Set()); else ui.setSelectedFiles(new Set(core.files.map((f: FileItem) => f.id))); };

    const handleRangeSelect = () => {
        const start = parseInt(ui.rangeStart);
        const end = parseInt(ui.rangeEnd);
        
        if (isNaN(start) || isNaN(end) || start > end || start < 1) {
            ui.addToast("Vui lòng nhập khoảng hợp lệ (Start <= End)", "warning");
            return;
        }

        // Note: core.files are NOT guaranteed to be sorted by index unless we sort them.
        // But usually they are displayed in list order. We'll select based on Array Index (1-based for user).
        const newSelected = new Set(ui.selectedFiles);
        const maxIndex = core.files.length;
        const actualStart = Math.max(0, start - 1);
        const actualEnd = Math.min(maxIndex, end);

        for (let i = actualStart; i < actualEnd; i++) {
            newSelected.add(core.files[i].id);
        }
        
        ui.setSelectedFiles(newSelected);
        ui.addToast(`Đã chọn ${newSelected.size} file (Từ ${start} đến ${actualEnd})`, "success");
    };

    const handleQuickParse = () => {
        const raw = ui.quickInput.trim();
        if (!raw) return;
        const newTags = raw.split(/[,;\n]+/).map((t: string) => t.trim()).filter(Boolean);
        core.setStoryInfo((prev: any) => {
            const current: string[] = prev.genres || [];
            const merged = [...current];
            newTags.forEach((tag: string) => {
                if (!merged.some(g => g.toLowerCase() === tag.toLowerCase())) merged.push(tag);
            });
            return { ...prev, genres: merged };
        });
        ui.setQuickInput('');
        ui.addToast(`Đã thêm ${newTags.length} thẻ thể loại`, "success");
    };

    return {
        handleSaveSelected,
        handleMergeSelected,
        handleRemoveFile,
        handleSmartDelete,
        requestDeleteAll,
        requestResetApp,
        handleSelectFile,
        selectAll,
        handleRangeSelect,
        handleQuickParse,
    };
};
