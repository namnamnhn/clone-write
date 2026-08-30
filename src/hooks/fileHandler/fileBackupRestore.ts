// Nhóm hàm: BACKUP/KHÔI PHỤC toàn bộ dữ liệu app ra/from 1 file JSON.
import { FileItem } from '../../types';
import { downloadJsonFile, fileToBase64, base64ToFile, reconcileStaleRescueLocks, reconcileStaleRawCount } from '../../utils/fileHelpers';
import { clearSessionRecord } from '../../utils/storage';
import { readFileAsText } from '../../utils/fileHelpers';
import type { CoreApi, UIApi } from '../apiTypes';

export const useFileBackupRestore = (core: CoreApi, ui: UIApi) => {
    const handleBackup = async () => {
        let coverBase64 = null;
        if (core.coverImage) {
            try { coverBase64 = await fileToBase64(core.coverImage); } catch(e) { console.warn("Lỗi mã hóa ảnh bìa:", e); }
        }
        const dataToSave = { ...core.stateRef.current, coverImageBase64: coverBase64, lastSaved: new Date().toISOString(), batchLimits: core.batchLimits, ratioLimits: core.ratioLimits };
        const safeData = { ...dataToSave };
        delete safeData.coverImage;
        delete safeData.deepseekKey; // Do not backup API key
        // fix44: dọn luôn key OpenRouter cũ còn sót trong dữ liệu legacy (nếu có).
        delete (safeData as any).openRouterKey;
        delete (safeData as any).openRouterModel;
        downloadJsonFile(`Backup_${core.storyInfo.title || 'Data'}_${new Date().toISOString().split('T')[0]}.json`, safeData);
        ui.addToast("Đã xuất file Backup (.json) kèm Ảnh bìa", "success");
    };


    const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>): Promise<boolean> => {
        const file = e.target.files?.[0];
        if (!file) return false;
        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);
            if (data.files && Array.isArray(data.files)) {
                // FIX (khôi phục mất luôn bản dự phòng tự động): trước đây dùng clearDatabase()
                // xoá SẠCH cả IndexedDB (kèm kho app_backups chứa 5 snapshot dự phòng tự động và
                // Translation Memory) TRƯỚC khi ghi dữ liệu mới — khôi phục nhầm backup cũ sẽ mất
                // luôn lưới an toàn của công việc gần nhất. Giờ chỉ xóa đúng record phiên cũ
                // (put() ở saveSession vốn ghi đè được, xoá chỉ mang tính phòng ngừa quota/hỏng).
                try {
                    await clearSessionRecord('current_session_v1');
                } catch (clearErr) {
                    console.warn("Could not clear old session record before restore, proceeding anyway...", clearErr);
                }
                
                // Phiên làm việc mới: reset cờ "bản dịch nghi vấn do hậu kiểm" (hasStaleTranslation) -
                // trạng thái cách ly tạm thời đó không nên tồn tại xuyên suốt qua các phiên khác nhau.
                const staleResetFiles = (data.files as FileItem[]).map(f => f.hasStaleTranslation ? { ...f, hasStaleTranslation: false } : f);
                // FIX (fix21): dọn cờ isRescueLocked treo oan trên file đã COMPLETED (backup cũ có
                // thể mang theo cờ này từ 1 phiên bản app trước đó) - xem reconcileStaleRescueLocks().
                // FIX (fix56): tự sửa luôn remainingRawCharCount sai kẹt lại từ backup cũ - xem
                // reconcileStaleRawCount().
                const restoredFiles = reconcileStaleRawCount(reconcileStaleRescueLocks(staleResetFiles));
                core.setFiles(restoredFiles);
                if (data.storyInfo) core.setStoryInfo({ ...core.storyInfo, ...data.storyInfo });
                if (data.creativeState) core.setCreativeState(data.creativeState);
                if (data.sinoVietnameseState) core.setSinoVietnameseState(data.sinoVietnameseState);
                if (data.fixErrorState) core.setFixErrorState(data.fixErrorState);
                if (data.promptTemplate) core.setPromptTemplate(data.promptTemplate);
                if (data.additionalDictionary) core.setAdditionalDictionary(data.additionalDictionary);
                
                // Restore Limits with Forced Updates
                if (data.batchLimits) {
                    const bl = { ...data.batchLimits };
                    if (bl.latin) {
                        if (bl.latin.v31 === undefined) bl.latin.v31 = 10;
                        if (bl.latin.v36 === undefined) bl.latin.v36 = 6;
                        if (bl.latin.v35 === undefined || bl.latin.v35 === 5 || bl.latin.v35 === 10) bl.latin.v35 = 6;
                    }
                    if (bl.complex) {
                        if (bl.complex.v31 === undefined) bl.complex.v31 = 10;
                        if (bl.complex.v36 === undefined) bl.complex.v36 = 6;
                        if (bl.complex.v35 === undefined || bl.complex.v35 === 5 || bl.complex.v35 === 10) bl.complex.v35 = 6;
                    }
                    
                    core.setBatchLimits(bl);
                }
                if (data.ratioLimits) {
                    const rl = { ...data.ratioLimits };
                    // Force update VN min ratio if it's the old default (0.3) or missing
                    if (rl.vn) {
                        if (rl.vn.min === 0.3 || rl.vn.min === undefined) rl.vn.min = 0.6;
                    }
                    core.setRatioLimits(rl);
                }

                // FIX (restore mất cài đặt): backup luôn chứa concurrency/autoSaveInterval nhưng
                // handleRestore từng không đọc 2 field này — khôi phục ở máy khác về mặc định
                // 'auto'/2 phút trong khi nạp lại phiên từ IndexedDB thì giữ đúng giá trị. Đồng bộ
                // hành vi 2 đường nạp dữ liệu.
                if (data.concurrency !== undefined && data.concurrency !== null) core.setConcurrency(data.concurrency);
                if (data.autoSaveInterval !== undefined && data.autoSaveInterval !== null) core.setAutoSaveInterval(data.autoSaveInterval);

                if (data.enabledModels) {
                    // Filter valid models and explicitly ensure 3.1 flash lite is enabled
                    const validModels = data.enabledModels.filter((id: string) => core.modelConfigs?.some((m: any) => m.id === id));
                    if (!validModels.includes('gemini-3.6-flash')) {
                        validModels.push('gemini-3.6-flash');
                    }
                    // Model mới Gemini 3.7 Flash: backup cũ chưa có id này -> tự bật mặc định.
                    if (!validModels.includes('gemini-3.7-flash')) {
                        validModels.push('gemini-3.7-flash');
                    }
                    if (!validModels.includes('gemini-3.5-flash-lite')) {
                        validModels.push('gemini-3.5-flash-lite');
                    }
                    if (!validModels.includes('gemini-3.1-flash-lite')) {
                        validModels.push('gemini-3.1-flash-lite');
                    }
                    if (!validModels.includes('gemini-3.5-flash')) {
                        validModels.push('gemini-3.5-flash');
                    }
                    if (!validModels.includes('gemini-3-flash-preview')) {
                        validModels.push('gemini-3-flash-preview');
                    }
                    if (!validModels.includes('gemini-3.1-flash-lite-image')) {
                        validModels.push('gemini-3.1-flash-lite-image');
                    }
                    if (!validModels.includes('gemma-4-26b-a4b-it')) {
                        validModels.push('gemma-4-26b-a4b-it');
                    }
                    if (!validModels.includes('gemma-4-31b-it')) {
                        validModels.push('gemma-4-31b-it');
                    }
                    core.setEnabledModels(validModels);
                } else {
                    // If no enabledModels in backup, enable all by default
                    if (core.modelConfigs) {
                        core.setEnabledModels(core.modelConfigs.map((m: any) => m.id));
                    }
                }

                if (data.coverImageBase64) {
                    try { core.setCoverImage(base64ToFile(data.coverImageBase64, "restored_cover.png")); } catch { /* ignore */ }
                }
                ui.setActiveTab('workspace'); // Select 'Biên tập' tab
                ui.setCurrentPage(1); // Show page 1
                ui.setFilterStatuses(new Set()); // Clear filters
                ui.setFilterModels(new Set()); // Clear filters
                
                // Force an immediate save to IndexedDB to prevent silent failures, overriding stale checks
                const saveSuccess = await core.saveSession(true, true);
                
                if (saveSuccess) {
                    ui.addToast("Khôi phục dữ liệu thành công!", "success");
                } else {
                    ui.addToast("Khôi phục thành công trên giao diện, nhưng lỗi khi lưu vào bộ nhớ. Vui lòng Reset Data App và thử lại.", "error");
                }
                
                e.target.value = '';
                return saveSuccess;
            } else { 
                ui.addToast("File Backup không hợp lệ", "error"); 
                e.target.value = '';
                return false;
            }
        } catch (err: any) { 
            ui.addToast(`Lỗi khôi phục: ${err.message}`, "error"); 
            e.target.value = '';
            return false;
        }
    };

    // Đồng bộ CHỈ thông tin bổ trợ (Thông Tin Truyện/Tag/Ngữ Cảnh/Quy Tắc Bổ Sung, Từ Điển,
    // Prompt Tối Ưu) từ 1 file backup .json - KHÔNG đụng tới danh sách file/chương hiện tại,
    // KHÔNG clearDatabase(), KHÔNG đổi batchLimits/ratioLimits/enabledModels/API key. Dành cho
    // người đang dịch truyện (có backup từ phiên/máy khác) chỉ muốn dùng công cụ Sửa Lỗi/Hán
    // Việt ở đây trên 1 file đã dịch sẵn mới import, mà không muốn mất file đó khi đồng bộ.
    // Field nào hiện tại đã có dữ liệu thì GIỮ NGUYÊN (không ghi đè) - chỉ điền vào chỗ trống;
    // riêng Từ Điển được GỘP THÊM (nối chuỗi) giống hành vi handleDictionaryUpload sẵn có.
    const handleSyncSupportInfo = async (e: React.ChangeEvent<HTMLInputElement>): Promise<boolean> => {
        const file = e.target.files?.[0];
        if (!file) return false;
        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);
            if (!data || (!data.storyInfo && !data.promptTemplate && !data.additionalDictionary)) {
                ui.addToast("File không chứa thông tin đồng bộ hợp lệ (thiếu storyInfo/promptTemplate/dictionary).", "error");
                return false;
            }
            // Cảnh báo nhẹ (không chặn - vẫn đọc đúng vì cùng field tên) nếu người dùng lỡ chọn
            // nhầm 1 file Backup TOÀN BỘ (có mảng `files`, thường rất nặng) vào ô Đồng Bộ thay vì
            // đúng file "Xuất Bổ Trợ" gọn nhẹ (đề xuất cải thiện tồn đọng).
            if (data.type !== 'support-info-only' && Array.isArray(data.files) && data.files.length > 0) {
                ui.addToast(`Lưu ý: tệp này có vẻ là Backup TOÀN BỘ (kèm ${data.files.length} file/chương), không phải gói "Xuất Bổ Trợ" gọn nhẹ - vẫn đọc đúng nhưng sẽ chậm hơn không cần thiết.`, "info");
            }
            if (data.storyInfo) {
                const src = data.storyInfo;
                core.setStoryInfo((prev: any) => ({
                    ...prev,
                    title: prev.title && prev.title.trim() ? prev.title : (src.title || prev.title),
                    author: prev.author && prev.author.trim() ? prev.author : (src.author || prev.author),
                    languages: (prev.languages && prev.languages.length > 0) ? prev.languages : (src.languages || []),
                    genres: (prev.genres && prev.genres.length > 0) ? prev.genres : (src.genres || []),
                    mcPersonality: (prev.mcPersonality && prev.mcPersonality.length > 0) ? prev.mcPersonality : (src.mcPersonality || []),
                    worldSetting: (prev.worldSetting && prev.worldSetting.length > 0) ? prev.worldSetting : (src.worldSetting || []),
                    sectFlow: (prev.sectFlow && prev.sectFlow.length > 0) ? prev.sectFlow : (src.sectFlow || []),
                    contextNotes: (prev.contextNotes && prev.contextNotes.trim()) ? prev.contextNotes : (src.contextNotes || ''),
                    summary: (prev.summary && prev.summary.trim()) ? prev.summary : (src.summary || ''),
                    additionalRules: (prev.additionalRules && prev.additionalRules.trim()) ? prev.additionalRules : (src.additionalRules || ''),
                }));
            }
            if (data.promptTemplate && (!core.promptTemplate || !core.promptTemplate.trim())) {
                core.setPromptTemplate(data.promptTemplate);
            }
            if (data.additionalDictionary && data.additionalDictionary.trim()) {
                const merged = core.additionalDictionary ? (core.additionalDictionary + "\n" + data.additionalDictionary) : data.additionalDictionary;
                core.setAdditionalDictionary(merged);
            }
            ui.addToast("Đã đồng bộ Thông Tin Truyện / Tag / Ngữ Cảnh / Từ Điển / Prompt Tối Ưu / Quy Tắc Bổ Sung từ backup.", "success");
            return true;
        } catch (err: any) {
            ui.addToast(`Lỗi đọc file đồng bộ: ${err.message}`, "error");
            return false;
        } finally {
            e.target.value = '';
        }
    };

    // Xuất riêng gói "Thông Tin Bổ Trợ" (Thông Tin Truyện/Tag/Ngữ Cảnh/Quy Tắc Bổ Sung, Từ
    // Điển, Prompt Tối Ưu) - file nhỏ gọn hơn nhiều so với backup toàn bộ (không kèm files/
    // chương, ảnh bìa, batchLimits...). Cùng định dạng (storyInfo/promptTemplate/
    // additionalDictionary) mà handleSyncSupportInfo() đọc vào, nên xuất ở máy/phiên này rồi
    // Đồng Bộ ở máy/phiên khác là dùng được ngay.
    const handleExportSupportInfo = () => {
        const dataToSave = {
            // Marker (đề xuất cải thiện tồn đọng): phân biệt rõ với file Backup toàn bộ (không
            // có field này) - dùng để handleSyncSupportInfo() cảnh báo sớm nếu người dùng lỡ chọn
            // nhầm file backup nặng vào ô Đồng Bộ.
            type: 'support-info-only',
            storyInfo: core.storyInfo,
            promptTemplate: core.promptTemplate,
            additionalDictionary: core.additionalDictionary,
            exportedAt: new Date().toISOString(),
        };
        downloadJsonFile(`ThongTinBoTro_${core.storyInfo.title || 'Data'}_${new Date().toISOString().split('T')[0]}.json`, dataToSave);
        ui.addToast("Đã xuất gói Thông Tin Bổ Trợ (.json, không kèm file/chương)", "success");
    };

    return { handleBackup, handleRestore, handleSyncSupportInfo, handleExportSupportInfo };
};
