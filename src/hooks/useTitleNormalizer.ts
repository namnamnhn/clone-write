import { useState, useRef } from 'react';
import { FileItem } from '../types';
import { generateTitleBatch } from '../services/workflows/translate/titleBatch';
import { fixMergedTitle, formatBookStyle } from '../utils/text';
import type { CoreApi, UIApi } from './apiTypes';

export const useTitleNormalizer = (core: CoreApi, ui: UIApi) => {
    const [isNormalizingTitles, setIsNormalizingTitles] = useState<boolean>(false);
    const isNormalizingRef = useRef<boolean>(false);

    const handleTitleNormalization = async (scope: 'all' | 'selected' = 'all') => {
        const titleFmtEnabled = core.storyInfo?.enableTitleFormatting !== false;
        if (!titleFmtEnabled) {
            ui.addLog("Đã bỏ qua bước chuẩn hóa tiêu đề do cài đặt.", "info");
            return true;
        }

        const allCandidates = core.files.filter((f: FileItem) => {
            if (scope === 'selected' && !ui.selectedFiles.has(f.id)) return false;
            if (!f.translatedContent) return false;
            return true;
        });

        if (allCandidates.length === 0) {
            ui.addToast("Không tìm thấy chương nào cần chuẩn hóa tiêu đề.", "info");
            return false;
        }

        setIsNormalizingTitles(true);
        isNormalizingRef.current = true;

        const aiCandidates: FileItem[] = [];
        const localUpdates: { id: string, content: string }[] = [];

        ui.setActionProgress({ current: 0, total: 100, message: "Đang phân tích tiêu đề..." });
        
        // Phân loại: file nào đã chuẩn form thì chỉ sửa local, file nào chưa chuẩn thì đưa cho AI
        const LOCAL_CHUNK_SIZE = 100;
        for (let i = 0; i < allCandidates.length; i += LOCAL_CHUNK_SIZE) {
            await new Promise(r => setTimeout(r, 0));
            const chunk = allCandidates.slice(i, i + LOCAL_CHUNK_SIZE);
            for (const f of chunk) {
                const fixedContent = fixMergedTitle(f.translatedContent || "");
                const lines = fixedContent.split('\n');
                let firstLineIdx = 0;
                while (firstLineIdx < lines.length && !lines[firstLineIdx].trim()) {
                    firstLineIdx++;
                }

                // Local fix for split titles was removed per user instruction to NEVER pull content lines up as titles.
                // If it is just 'Chương 1:', we keep it as is.
                const firstLine = firstLineIdx < lines.length ? lines[firstLineIdx].trim() : "";
                const cleanFirstLine = firstLine.replace(/^[\s*#]+/, '');
                const isStandard = /^(?:[Tập|Quyển]?\s*\d+\s*[-:]?\s*)?(Chương|Ngoại\s*chương|Phụ\s*chương|Phiên\s*ngoại|Tiết|Hồi|Tập|Quyển)\s+\d+[\s:*-]/i.test(cleanFirstLine) && cleanFirstLine.length < 150;

                if (isStandard) {
                    const cleanContent = formatBookStyle(fixedContent, f.content, titleFmtEnabled, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                    // Nếu nội dung thay đổi sau khi fixMergedTitle, merge title, và formatBookStyle, hoặc nếu scope là selected
                    if (cleanContent !== f.translatedContent || scope === 'selected') {
                        localUpdates.push({ id: f.id, content: cleanContent });
                    }
                } else {
                    aiCandidates.push(f);
                }
            }
            ui.setActionProgress({ current: Math.min(100, Math.round(((i + LOCAL_CHUNK_SIZE) / allCandidates.length) * 100)), total: 100, message: "Đang phân tích tiêu đề..." });
        }
        
        ui.setActionProgress(null);

        // Cập nhật ngay các file chỉ cần xử lý local
        if (localUpdates.length > 0) {
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                const update = localUpdates.find(u => u.id === f.id);
                if (update) {
                    return { ...f, translatedContent: update.content };
                }
                return f;
            }));
            ui.addLog(`Đã chuẩn hóa local định dạng cho ${localUpdates.length} chương (không cần AI).`, 'success');
        }

        if (aiCandidates.length === 0) {
            setIsNormalizingTitles(false);
            ui.setActionProgress(null);
            ui.addToast(`Đã chuẩn hóa tiêu đề xong!`, "success");
            core.saveSession(true);
            return true;
        }

        ui.addToast(`Bắt đầu chuẩn hóa tiêu đề bằng AI cho ${aiCandidates.length} chương...`, "info");

        const CHUNK_SIZE = 10;
        const CONCURRENCY = 5;
        
        const chunks = [];
        for (let i = 0; i < aiCandidates.length; i += CHUNK_SIZE) {
            chunks.push(aiCandidates.slice(i, i + CHUNK_SIZE));
        }

        let completed = 0;
        const total = aiCandidates.length;

        const processChunk = async (chunk: FileItem[]) => {
            const inputs = chunk.map(f => {
                const fixedContent = fixMergedTitle(f.translatedContent || "");
                const lines = fixedContent.split('\n');
                let firstLineIdx = 0;
                while (firstLineIdx < lines.length && !lines[firstLineIdx].trim()) {
                    firstLineIdx++;
                }
                
                const headerLines = [];
                let i = 0;
                while (headerLines.length < 3 && firstLineIdx + i < lines.length) {
                    const line = lines[firstLineIdx + i].trim();
                    if (line) {
                        headerLines.push(line);
                    }
                    i++;
                }
                const currentHeader = headerLines.join('\n');
                
                const rawLines = (f.content || "").split('\n');
                let rawFirstLineIdx = 0;
                while (rawFirstLineIdx < rawLines.length && !rawLines[rawFirstLineIdx].trim()) {
                    rawFirstLineIdx++;
                }
                const rawHeaderLines = [];
                let j = 0;
                while (rawHeaderLines.length < 3 && rawFirstLineIdx + j < rawLines.length) {
                    const line = rawLines[rawFirstLineIdx + j].trim();
                    if (line) {
                        rawHeaderLines.push(line);
                    }
                    j++;
                }
                const originalRawHeader = rawHeaderLines.join('\n');
                
                return {
                    id: f.id,
                    content: fixedContent,
                    currentHeader: currentHeader,
                    originalRawHeader: originalRawHeader
                };
            });

            try {
                const resultsMap = await generateTitleBatch(
                    inputs, 
                    core.storyInfo, 
                    (msg) => ui.addLog(msg, 'info'), 
                    core.enabledModels,
                    () => !isNormalizingRef.current
                );
                
                core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                    if (resultsMap.has(f.id)) {
                        const result = resultsMap.get(f.id);
                        if (result && f.translatedContent) {
                            let newTitle = result.title.replace(/\n+/g, ' ').trim();
                            newTitle = newTitle.replace(/^[\s*#]+|[\s*#]+$/g, '');
                            const linesToReplace = result.linesToReplace || 0;
                            
                            const fixedContent = fixMergedTitle(f.translatedContent);
                            let lines = fixedContent.split('\n');
                            
                            // If title is empty and we replace 0 lines, we do absolutely nothing
                            if (newTitle === "" && linesToReplace === 0) {
                                const cleanContent = formatBookStyle(fixedContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                                return { ...f, translatedContent: cleanContent };
                            }

                            let firstLineIdx = 0;
                            while (firstLineIdx < lines.length && !lines[firstLineIdx].trim()) {
                                firstLineIdx++;
                            }
                            
                            if (firstLineIdx >= lines.length) {
                                if (newTitle) lines = [newTitle, "", ""];
                            } else {
                                const originalLine = lines[firstLineIdx];
                                
                                if (linesToReplace === 1 && newTitle && originalLine.length > newTitle.length + 30) {
                                    // The title was likely merged with the content.
                                    let splitIdx = newTitle.length;
                                    while (splitIdx > 0 && originalLine[splitIdx] !== ' ') {
                                        splitIdx--;
                                    }
                                    const contentPart = originalLine.substring(splitIdx).trim();
                                    lines.splice(firstLineIdx, 1, newTitle, "", contentPart);
                                } else {
                                    let linesRemoved = 0;
                                    const currentIdx = firstLineIdx;
                                    
                                    while (linesRemoved < linesToReplace && currentIdx < lines.length) {
                                        if (lines[currentIdx].trim() !== "") {
                                            linesRemoved++;
                                        }
                                        lines.splice(currentIdx, 1);
                                    }
                                    
                                    while (currentIdx < lines.length && lines[currentIdx].trim() === "") {
                                        lines.splice(currentIdx, 1);
                                    }
                                    
                                    if (newTitle) {
                                        lines.splice(firstLineIdx, 0, newTitle);
                                        if (lines.length > firstLineIdx + 1) {
                                            if (lines[firstLineIdx + 1].trim() !== "") {
                                                lines.splice(firstLineIdx + 1, 0, "");
                                            }
                                        } else {
                                            lines.push("");
                                        }
                                    }
                                }
                            }
                            
                            const newContent = lines.join('\n');
                            const cleanContent = formatBookStyle(newContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                            return { ...f, translatedContent: cleanContent, titleGeneratedByAI: !!newTitle };
                        }
                    }
                    return f;
                }));
            } catch (e: any) {
                if (e.message === 'ABORTED') {
                    console.log("Title Normalization: Aborted by user.");
                    return;
                }
                console.error("Title Batch Error", e);
            } finally {
                completed += chunk.length;
                ui.setActionProgress({ current: completed, total: total, message: `Đang chuẩn hóa tiêu đề: ${completed}/${total}` });
            }
        };

        const queue = [...chunks];
        const workers = Array(Math.min(chunks.length, CONCURRENCY)).fill(null).map(async () => {
            while (queue.length > 0) {
                const chunk = queue.shift();
                if (chunk) await processChunk(chunk);
            }
        });
        await Promise.all(workers);

        // Người dùng chủ động bấm Dừng: stopTitleNormalization đã flip isNormalizingRef về false
        // và tự hiện toast "Đã dừng" - không được báo thêm "xong!" thành công + save như hoàn tất.
        const wasStopped = !isNormalizingRef.current;

        setIsNormalizingTitles(false);
        ui.setActionProgress(null);
        if (!wasStopped) {
            ui.addToast(`Đã chuẩn hóa tiêu đề xong!`, "success");
            core.saveSession(true);
        }
        return true;
    };

    const stopTitleNormalization = () => {
        isNormalizingRef.current = false;
        setIsNormalizingTitles(false);
        ui.setActionProgress(null);
        ui.addToast("Đã dừng chuẩn hóa tiêu đề.", "info");
    };

    return {
        isNormalizingTitles,
        handleTitleNormalization,
        stopTitleNormalization
    };
};
