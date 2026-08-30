// Nhóm hàm: NHẬP file (parse zip/docx/pdf/epub, dán nội dung, ghép thêm vào danh sách hiện có).
import { FileItem, FileStatus } from '../../types';
import { unzipFiles, parseEpub, parseDocx, parsePdf, readFileAsText, parseFilenameMetadata, renumberFiles, sortFiles } from '../../utils/fileHelpers';
import { countForeignChars, detectFragmentationMultiplier, removeJunkContent } from '../../utils/text';
import { cleanGarbageText } from '../../utils/text/garbageCleaner';
import type { CoreApi, UIApi } from '../apiTypes';

export const useFileImport = (core: CoreApi, ui: UIApi, onFilesAdded?: () => void) => {
    const processFiles = async (fileList: File[], isTranslatedImport: boolean = false) => {
        if (fileList.length === 0) return;
        ui.setImportProgress({ current: 0, total: fileList.length, message: 'Đang chuẩn bị...' });
        const processedNewFiles: FileItem[] = [];
        const updatedStoryInfo = { ...core.storyInfo };
        let infoFound = false;
        // Giữ bìa của nguồn đang nhập ở trạng thái tạm cho đến khi người dùng chọn Ghi đè hay
        // Nối tiếp. Không ghi thẳng vào core.coverImage vì sẽ làm bìa dự án hiện tại/phiên trước
        // lọt sang dự án mới hoặc bị thay dù người dùng bấm Huỷ/Nối tiếp.
        let importedCover: File | null = null;
        let needsExplicitSplit = false;
        // EPUB tách ra >1 chương theo Mục lục (TOC) gốc -> vẫn cho người dùng cơ hội chọn
        // "Gộp & Tách lại bằng Regex" thay vì luôn tự ý nhận theo TOC, phòng trường hợp Mục lục
        // của file đó không chuẩn/không khớp thực tế (ví dụ Mục lục thiếu mục, gộp nhầm chương...).
        let hasEpubMultiChapter = false;

        try {
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                ui.setImportProgress({ current: i, total: fileList.length, message: `Đang đọc ${file.name}...` });
                await new Promise(r => setTimeout(r, 20));

                const createNewFileItem = (name: string, content: string): FileItem => {
                    // Pre-clean raw content to remove junk tags (like unbalanced <i>) to prevent translation hallucinations
                    const cleanedContent = removeJunkContent(content);
                    const fragMultiplier = detectFragmentationMultiplier(cleanedContent);
                    const isFragmentedSource = fragMultiplier > 1.05;
                    
                    return {
                        id: crypto.randomUUID(),
                        name: name,
                        content: cleanedContent,
                        translatedContent: isTranslatedImport ? cleanedContent : null,
                        status: isTranslatedImport ? FileStatus.COMPLETED : FileStatus.IDLE,
                        retryCount: 0,
                        originalCharCount: cleanedContent.length,
                        // FIX (fix56): trước đây dùng thẳng cleanedContent.length (độ dài RAW
                        // TOÀN BỘ, kể cả dấu câu/khoảng trắng) làm placeholder cho file chưa dịch,
                        // thay vì đếm đúng số ký tự "raw thật" (CJK/Kana/Hangul/Cyrillic/Thái)
                        // như countForeignChars đang dùng ở MỌI nơi khác trong app. Nếu vì lý do
                        // nào đó (backup/restore từ session cũ, hoặc file được đánh dấu COMPLETED
                        // qua 1 luồng khác mà không đi qua bước tính lại remainingRawCharCount)
                        // giá trị placeholder này không được ghi đè, badge "Sót Raw" sẽ hiển thị
                        // gần bằng NGUYÊN VĂN độ dài file gốc dù bản dịch thực tế đã sạch — đúng
                        // như người dùng mô tả "app bê nguyên tất cả raw ở file gốc lên". Đổi
                        // sang countForeignChars cho nhất quán với mọi nơi khác (xem thêm
                        // reconcileStaleRawCount ở core.ts — lưới an toàn tự sửa lại các file cũ
                        // đã lỡ dính giá trị sai kiểu này).
                        remainingRawCharCount: countForeignChars(cleanedContent),
                        isFragmentedSource
                    };
                };

                if (file.name.endsWith('.zip')) {
                    try {
                        const { title, author } = parseFilenameMetadata(file.name);
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; if (author) updatedStoryInfo.author = author; infoFound = true; }
                        const extractedFiles = await unzipFiles(file, (current, total, percent) => {
                            ui.setImportProgress({ current: percent, total: 100, message: `Đang mở chương ${current} / ${total}` });
                        });
                        // ... existing extractedFiles logic ...
                        if (isTranslatedImport) {
                            extractedFiles.forEach(f => {
                                f.translatedContent = f.content;
                                f.status = FileStatus.COMPLETED;
                                f.remainingRawCharCount = countForeignChars(f.content);
                            });
                        }
                        processedNewFiles.push(...extractedFiles);
                    } catch { ui.addToast(`Lỗi ZIP: ${file.name}`, 'error'); }
                } else if (file.name.endsWith('.epub')) {
                    try {
                        const result = await parseEpub(file, (current, total, percent) => {
                            ui.setImportProgress({ current: percent, total: 100, message: `Đang đọc chương ${current} / ${total}` });
                        });
                        if (result.info.title && !updatedStoryInfo.title) { updatedStoryInfo.title = result.info.title; if (result.info.author && !updatedStoryInfo.author) { updatedStoryInfo.author = result.info.author; } infoFound = true; }
                        if (result.coverBlob && !importedCover) {
                            importedCover = new File([result.coverBlob], "cover.jpg", { type: result.coverBlob.type });
                        }
                        
                        let epubFiles = result.files;
                        if (isTranslatedImport) {
                            epubFiles = epubFiles.map(f => ({
                                ...f,
                                translatedContent: f.content,
                                status: FileStatus.COMPLETED,
                                remainingRawCharCount: countForeignChars(f.content)
                            }));
                        }

                        if (result.needsSplit && epubFiles.length === 1) { needsExplicitSplit = true; processedNewFiles.push(epubFiles[0]); } else { if (epubFiles.length > 1) hasEpubMultiChapter = true; processedNewFiles.push(...epubFiles); }
                    } catch (e: any) { ui.addToast(`Lỗi EPUB: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                    try {
                        const { content, title, author } = await parseDocx(file);
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; infoFound = true; }
                        if (author && !updatedStoryInfo.author) { updatedStoryInfo.author = author; infoFound = true; }
                        if (!infoFound) { const meta = parseFilenameMetadata(file.name); if(meta.title) updatedStoryInfo.title = meta.title; if(meta.author) updatedStoryInfo.author = meta.author; infoFound = true; }
                        processedNewFiles.push(createNewFileItem(file.name, content));
                    } catch(e: any) { ui.addToast(`Lỗi DOCX: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.pdf')) {
                    try {
                        const { content, files, title, author } = await parsePdf(file, (percent, msg) => ui.setImportProgress({current: percent, total: 100, message: msg}));
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; infoFound = true; }
                        if (author && !updatedStoryInfo.author) { updatedStoryInfo.author = author; infoFound = true; }
                        if (!infoFound) { const meta = parseFilenameMetadata(file.name); if(meta.title) updatedStoryInfo.title = meta.title; if(meta.author) updatedStoryInfo.author = meta.author; infoFound = true; }
                        if (files.length > 0) { 
                            if (isTranslatedImport) {
                                files.forEach(f => {
                                    f.translatedContent = f.content;
                                    f.status = FileStatus.COMPLETED;
                                    f.remainingRawCharCount = countForeignChars(f.content);
                                });
                            }
                            processedNewFiles.push(...files); 
                        } else { 
                            processedNewFiles.push(createNewFileItem(file.name, content)); 
                        }
                    } catch (e: any) { ui.addToast(`Lỗi PDF: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.txt') || file.name.endsWith('.srt') || file.name.endsWith('.vtt')) {
                    // .srt/.vtt (phụ đề phim) là văn bản thuần, đọc y hệt .txt - prompt dịch gốc
                    // (mục 0.4 "ĐỊNH DẠNG PHỤ ĐỀ SRT") đã tự nhận diện khối số thứ tự + mã thời
                    // gian và chỉ dịch phần lời thoại, giữ nguyên cấu trúc file phụ đề.
                    const content = await readFileAsText(file);
                    processedNewFiles.push(createNewFileItem(file.name, content));
                }
            }

            if (processedNewFiles.length === 0) { ui.setImportProgress(null); return; }
            
            // Clean all contents globally right after import to prevent hallucination errors
            const shouldCleanGarbage = core.storyInfo?.enableGarbageCleanOnImport !== false;
            for (let i = 0; i < processedNewFiles.length; i++) {
                let cleaned = removeJunkContent(processedNewFiles[i].content);
                // Lọc rác sơ bộ (Layer 2: thẻ HTML rác, ký tự *#= trơ trọi, chuỗi _/- lặp, chuẩn hóa .../!!!)
                // áp dụng ngay khi thêm file, cho MỌI định dạng (zip/epub/docx/txt/pdf) — không chỉ riêng
                // luồng qua Bộ Tách Chương (SplitterModal). File PDF có mục lục/dạng dọc đã được lọc từ lúc
                // parse (parsers.ts) nên bước này chỉ là an toàn kép, không đổi kết quả.
                if (shouldCleanGarbage) cleaned = cleanGarbageText(cleaned);
                processedNewFiles[i].content = cleaned;
                if (isTranslatedImport) {
                    processedNewFiles[i].translatedContent = cleaned;
                    processedNewFiles[i].remainingRawCharCount = countForeignChars(cleaned);
                } else {
                    processedNewFiles[i].originalCharCount = cleaned.length;
                    // FIX (fix56): trước đây gán thẳng `cleaned.length` (độ dài RAW toàn bộ) —
                    // xem giải thích chi tiết ở createNewFileItem phía trên trong cùng file này.
                    processedNewFiles[i].remainingRawCharCount = countForeignChars(cleaned);
                }
            }
            
            const hasLargeFile = processedNewFiles.some(f => f.content.length > 10000);
            
            // Với EPUB tách >1 chương theo Mục lục (TOC), luôn hỏi lại người dùng muốn giữ theo
            // TOC (mặc định, đúng cấu trúc gốc) hay Gộp & Tách lại bằng Regex -- không chỉ khi có
            // chương "quá lớn" (hasLargeFile) như trước, vì Mục lục lỗi/thiếu có thể khiến file bị
            // tách vụn thành nhiều chương NHỎ chứ không nhất thiết có chương lớn.
            if (processedNewFiles.length > 1 && (hasLargeFile || hasEpubMultiChapter) && !needsExplicitSplit) {
                ui.setImportModal({ isOpen: false, pendingFiles: processedNewFiles, tempInfo: infoFound ? updatedStoryInfo : null, tempCover: importedCover });
                ui.setZipActionModal(true, hasEpubMultiChapter ? 'epub' : 'zip');
                ui.setImportProgress(null);
                return;
            }

            if (needsExplicitSplit || hasLargeFile) {
                ui.setImportProgress({ current: 100, total: 100, message: 'Phát hiện chương gộp. Đang hợp nhất để tách lại...' });
                await new Promise(r => setTimeout(r, 100));
                const sortedForMerge = sortFiles(processedNewFiles);
                const hugeContent = sortedForMerge.map(f => f.content).join('\n\n');
                const mergedTitle = infoFound ? updatedStoryInfo.title : sortedForMerge[0].name;
                if (infoFound) core.setStoryInfo(updatedStoryInfo);
                ui.setSplitterModal({ isOpen: true, content: hugeContent, name: mergedTitle, isTranslatedImport, tempCover: importedCover });
                ui.setImportProgress(null);
                return;
            }

            if (core.files.length > 0) {
                ui.setImportModal({ isOpen: true, pendingFiles: processedNewFiles, tempInfo: infoFound ? updatedStoryInfo : null, tempCover: importedCover });
            } else {
                const sorted = sortFiles(processedNewFiles);
                core.setFiles(sorted);
                // Dự án mới không được kế thừa bìa còn sót của phiên trước. EPUB có bìa thì dùng
                // bìa vừa đọc; ZIP/TXT/PDF không có bìa thì xoá hẳn bìa cũ.
                core.setCoverImage(importedCover);
                if (infoFound) core.setStoryInfo(updatedStoryInfo);
                ui.setFilterStatuses(new Set()); // Clear filters
                ui.setFilterModels(new Set()); // Clear filters
                ui.addToast(`Đã thêm ${processedNewFiles.length} file`, 'success');
                onFilesAdded?.();
            }
        } catch (e: any) {
            ui.addToast(`Lỗi nhập file: ${e.message}`, 'error');
        } finally {
            ui.setImportProgress(null);
        }
    };


    const handleImportAppend = () => {
        let nextIndex = 1;
        if (core.files.length > 0) {
            const lastFile = core.files[core.files.length - 1];
            const match = lastFile.name.match(/^(\d{5})\s/);
            if (match) { nextIndex = parseInt(match[1], 10) + 1; } else { nextIndex = core.files.length + 1; }
        }
        const renumberedFiles = renumberFiles(ui.importModal.pendingFiles, nextIndex);
        const merged = [...core.files, ...renumberedFiles];
        core.setFiles(sortFiles(merged));
        ui.setImportModal({ isOpen: false, pendingFiles: [] });
        ui.setFilterStatuses(new Set()); // Clear filters
        ui.setFilterModels(new Set()); // Clear filters
        ui.addToast(`Đã thêm nối tiếp ${ui.importModal.pendingFiles.length} file`, 'success');
        onFilesAdded?.();
    };


    const handleImportOverwrite = () => {
        core.setFiles(sortFiles(ui.importModal.pendingFiles));
        core.setCoverImage(ui.importModal.tempCover || null);
        if (ui.importModal.tempInfo) {
            core.setStoryInfo({ ...ui.importModal.tempInfo, languages: [], genres: [], mcPersonality: [], worldSetting: [], sectFlow: [], contextNotes: '', summary: '' });
            core.setAdditionalDictionary('');
        }
        ui.setImportModal({ isOpen: false, pendingFiles: [] });
        ui.setFilterStatuses(new Set()); // Clear filters
        ui.setFilterModels(new Set()); // Clear filters
        ui.addToast(`Đã tạo truyện mới với ${ui.importModal.pendingFiles.length} file`, 'success');
        onFilesAdded?.();
    };


    const handlePasteConfirm = (title: string, content: string, isTranslated?: boolean) => {
        let cleanedContent = removeJunkContent(content);
        const contentLen = cleanedContent.length;
        // Nội dung dán ngắn (không đủ để bật SplitterModal) vẫn cần qua lọc rác sơ bộ nếu bật tùy chọn.
        if (contentLen <= 10000 && core.storyInfo?.enableGarbageCleanOnImport !== false) {
            cleanedContent = cleanGarbageText(cleanedContent);
        }
        if (contentLen > 10000) {
            ui.setSplitterModal({ isOpen: true, content: cleanedContent, name: title || "Truyện dán" });
            return;
        }
        
        const newFile: FileItem = { 
            id: crypto.randomUUID(), 
            name: title || `Chương ${core.files.length + 1}`, 
            content: cleanedContent, 
            translatedContent: isTranslated ? cleanedContent : null, 
            status: isTranslated ? FileStatus.COMPLETED : FileStatus.IDLE, 
            retryCount: 0, 
            originalCharCount: cleanedContent.length, 
            remainingRawCharCount: isTranslated ? countForeignChars(cleanedContent) : 0 
        };
        
        if (core.files.length > 0) {
            ui.setImportModal({ isOpen: true, pendingFiles: [newFile], tempInfo: null });
        } else {
            core.setFiles([newFile]);
            ui.setFilterStatuses(new Set()); // Clear filters
            ui.setFilterModels(new Set()); // Clear filters
            ui.addToast("Đã thêm nội dung", "success");
            onFilesAdded?.();
        }
    };

    // --- DOWNLOAD LOGIC ---

    return { processFiles, handleImportAppend, handleImportOverwrite, handlePasteConfirm };
};
