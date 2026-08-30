import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Columns, Link2, Replace, Bug, LifeBuoy, Save, X, FileText, Copy, Edit3, Maximize2, Minimize2, Lock, Unlock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { FileItem } from '../types';
import { FOREIGN_CHARS_REGEX, optimizeContext, optimizeDictionary, dedupeContextAgainstDictionary, addBlankLineBetweenParagraphs } from '../utils/text';
import { stripTitleAnchor } from '../utils/fileHelpers';

interface EditorModalProps {
    file: FileItem;
    onClose: () => void;
    onSave: (fileId: string, newContent: string) => void;
    onSaveAndNext: (fileId: string, newContent: string) => void;
    onSaveAndPrev?: (fileId: string, newContent: string) => void;
    onNext?: (fileId: string) => void;
    onPrev?: (fileId: string) => void;
    hasNext?: boolean;
    hasPrev?: boolean;
    onAutoSave: (fileId: string, newContent: string) => void;
    storyInfoContext: string;
    dictionary: string;
    promptTemplate: string;
    onAddToGlossary: (raw: string, edit: string) => void;
    onReplaceAll: (find: string, replace: string) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export const EditorModal: React.FC<EditorModalProps> = ({ 
    file, onClose, onSave, onSaveAndNext, onSaveAndPrev, onNext, onPrev, hasNext, hasPrev, onAutoSave, storyInfoContext, dictionary, promptTemplate, 
    onAddToGlossary, onReplaceAll, addToast
}) => {
    const [editContent, setEditContent] = useState<string>(file.translatedContent || "");
    const editContentRef = useRef(editContent);
    // FIX (xung đột đọc-trong-lúc-dịch / bị gắn nhầm "Thủ công"): trước đây code coi
    // "editContent !== file.translatedContent" là dấu hiệu người dùng đã sửa. Nhưng
    // file.translatedContent có thể tự thay đổi từ BÊN NGOÀI (bản dịch nền vừa chạy xong)
    // trong lúc modal vẫn đang mở xem CÙNG file đó — không liên quan gì tới việc gõ sửa.
    // Khi đó điều kiện trên vẫn đúng, khiến app tưởng nhầm là "có sửa" rồi tự động lưu ĐÈ
    // bản dịch AI vừa xong bằng nội dung cũ (lúc mở lên xem), và gắn nhãn "Thủ công" dù
    // người dùng chưa gõ chữ nào. isDirtyRef chỉ bật khi người dùng thực sự gõ vào ô sửa.
    const isDirtyRef = useRef(false);
    const lastFileIdRef = useRef(file.id);
    const hasWarnedExternalUpdateRef = useRef(false);

    useEffect(() => {
        editContentRef.current = editContent;

        // Auto-save with debounce — chỉ áp dụng khi người dùng THỰC SỰ đã gõ sửa.
        if (isDirtyRef.current) {
            const timer = setTimeout(() => {
                onAutoSave(file.id, editContent);
            }, 3000); // 3 seconds debounce
            return () => clearTimeout(timer);
        }
    }, [editContent, file.id, onAutoSave]);

    // Flush on unmount/chuyển chương để lưu thay đổi chưa kịp qua debounce 3s — cũng chỉ khi
    // người dùng thực sự có gõ sửa, KHÔNG dựa vào so sánh với file.translatedContent (giá trị
    // này có thể tự đổi do dịch nền vừa xong, không phải do người dùng).
    useEffect(() => {
        return () => {
            if (isDirtyRef.current) {
                onAutoSave(file.id, editContentRef.current);
            }
        };
    }, [file.id, onAutoSave]);

    // Đồng bộ nội dung hiển thị khi: (a) chuyển sang chương/file khác trong cùng modal, hoặc
    // (b) bản dịch AI của CÙNG chương này vừa cập nhật từ bên ngoài (dịch nền chạy xong) trong
    // lúc người dùng CHƯA gõ sửa gì — để người đọc luôn thấy đúng bản mới nhất mà không bị
    // tính nhầm là "đã chỉnh sửa thủ công" và không có nguy cơ ghi đè ngược lại bản AI.
    // Nếu người dùng ĐANG dở sửa (isDirtyRef = true) khi bản AI cập nhật, CỐ TÌNH không ghi
    // đè để không làm mất nội dung họ đang gõ — chỉ cảnh báo một lần cho biết có bản mới.
    useEffect(() => {
        if (file.id !== lastFileIdRef.current) {
            lastFileIdRef.current = file.id;
            isDirtyRef.current = false;
            hasWarnedExternalUpdateRef.current = false;
            setEditContent(file.translatedContent || "");
            setTimeout(() => {
                if (rawPanelRef.current) rawPanelRef.current.scrollTop = 0;
                if (editPanelRef.current) editPanelRef.current.scrollTop = 0;
            }, 0);
        } else if (!isDirtyRef.current) {
            setEditContent(file.translatedContent || "");
        } else if (!hasWarnedExternalUpdateRef.current) {
            hasWarnedExternalUpdateRef.current = true;
            addToast("Bản dịch AI của chương này vừa cập nhật trong lúc bạn đang sửa. Nội dung bạn đang gõ vẫn được giữ nguyên (chưa bị ghi đè).", "warning");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file.id, file.translatedContent]);

    const [checkMode, setCheckMode] = useState<'none' | 'raw' | 'dict'>('none');
    const [glossarySelection, setGlossarySelection] = useState<{raw: string, edit: string} | null>(null);
    const [editingGlossary, setEditingGlossary] = useState<{raw: string, edit: string}>({raw: '', edit: ''});

    const rawPanelRef = useRef<HTMLDivElement>(null);
    const editPanelRef = useRef<HTMLTextAreaElement>(null);
    const highlightOverlayRef = useRef<HTMLDivElement>(null);
    const isSyncingLeft = useRef(false);
    const isSyncingRight = useRef(false);
    const rawSelectionRef = useRef<string>(""); 
    const editSelectionRef = useRef<string>("");

    
    // Parse dictionary for highlighting
    const dictMap = React.useMemo<Map<string, string>>(() => {
        const map = new Map<string, string>();
        if (!dictionary) return map;
        const lines = dictionary.split('\n');
        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
                // Key is translated text, Value is raw text (for tooltip)
                map.set(parts[1].trim(), parts[0].trim());
            }
        }
        return map;
    }, [dictionary]);

    // Build regex for dictionary highlighting
    const dictRegex = React.useMemo(() => {
        if (dictMap.size === 0) return null;
        const terms = Array.from<string>(dictMap.keys()).map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        // Sort by length descending to match longest terms first
        terms.sort((a, b) => b.length - a.length);
        return new RegExp(`(${terms.join('|')})`, 'g');
    }, [dictMap]);
    
    // NEW: Focus Mode & Sync Toggle
    const [isFocusMode, setIsFocusMode] = useState(false);
    
    // Foreign char navigation
    const foreignCharIndices = React.useMemo(() => {
        const indices: number[] = [];
        if (checkMode === 'raw') {
            for (let i = 0; i < editContent.length; i++) {
                if (FOREIGN_CHARS_REGEX.test(editContent[i])) {
                    // Group consecutive foreign chars to avoid jumping 1 char at a time in a word
                    if (indices.length === 0 || i > indices[indices.length - 1] + 5) {
                        indices.push(i);
                    }
                }
            }
        }
        return indices;
    }, [editContent, checkMode]);

    const [currentForeignIndex, setCurrentForeignIndex] = useState(-1);

    // FIX (bug hiệu năng "giật/lag khi mở hoặc gõ ở chế độ Raw"): trước đây overlay highlight
    // render MỖI KÝ TỰ thành 1 thẻ <span> riêng (editContent.split('').map(...)) nên với 1 chương
    // vài nghìn/chục nghìn ký tự, mỗi lần gõ 1 phím (editContent đổi -> re-render) là hàng nghìn
    // node DOM bị tạo lại từ đầu, làm trình duyệt giật khựng rõ rệt. SỬA: gộp các ký tự LIÊN TIẾP
    // cùng loại (foreign/không-foreign) thành 1 segment/span duy nhất — số node giảm từ O(số ký
    // tự) xuống O(số đoạn văn bản nước ngoài + điểm điều hướng), thường chỉ còn vài chục node
    // thay vì hàng nghìn. Vẫn tích sẵn tọa độ các điểm điều hướng (foreignCharIndices) để nút
    // Next/Prev vẫn nhảy chính xác tới từng điểm nhảy cũ (xem data-nav-index + scrollToForeignChar).
    const rawHighlightSegments = React.useMemo(() => {
        if (checkMode !== 'raw' || !editContent) return [] as { text: string; isForeign: boolean; navIndex: number | null }[];
        const navSet = new Set(foreignCharIndices);
        const segments: { text: string; isForeign: boolean; navIndex: number | null }[] = [];
        let start = 0;
        for (let i = 1; i <= editContent.length; i++) {
            const prevForeign = FOREIGN_CHARS_REGEX.test(editContent[i - 1]);
            const currForeign = i < editContent.length ? FOREIGN_CHARS_REGEX.test(editContent[i]) : null;
            const typeChanges = currForeign !== null && currForeign !== prevForeign;
            const atNavBoundary = i < editContent.length && navSet.has(i);
            if (i === editContent.length || typeChanges || atNavBoundary) {
                segments.push({
                    text: editContent.slice(start, i),
                    isForeign: prevForeign,
                    navIndex: navSet.has(start) ? start : null,
                });
                start = i;
            }
        }
        return segments;
    }, [editContent, checkMode, foreignCharIndices]);

    /* eslint-disable react-hooks/immutability -- Event handlers intentionally synchronize DOM scroll positions through refs. */
    const scrollToForeignChar = (direction: 'next' | 'prev') => {
        if (foreignCharIndices.length === 0) return;
        
        let newIdx = currentForeignIndex;
        if (direction === 'next') {
            newIdx = currentForeignIndex + 1 >= foreignCharIndices.length ? 0 : currentForeignIndex + 1;
        } else {
            newIdx = currentForeignIndex - 1 < 0 ? foreignCharIndices.length - 1 : currentForeignIndex - 1;
        }
        setCurrentForeignIndex(newIdx);
        
        const charIndex = foreignCharIndices[newIdx];
        
        if (highlightOverlayRef.current && editPanelRef.current) {
            // FIX: trước đây dò `spans[charIndex]` dựa trên giả định MỖI ký tự có 1 span riêng
            // (đúng theo thứ tự index) — giả định này không còn đúng sau khi gộp segment (xem
            // rawHighlightSegments ở trên). Giờ dò trực tiếp bằng data-nav-index gắn sẵn
            // ứng tới điểm điều hướng, không phụ thuộc thứ tự/số lượng span.
            const targetSpan = highlightOverlayRef.current.querySelector(`[data-nav-index="${charIndex}"]`) as HTMLElement;
            if (targetSpan) {
                const top = targetSpan.offsetTop;
                editPanelRef.current.scrollTop = top - 100;
                highlightOverlayRef.current.scrollTop = top - 100;
                
                editPanelRef.current.focus();
                editPanelRef.current.setSelectionRange(charIndex, charIndex + 1);
            }
        }
    };
    
    // Auto-save disabled per user request
    // Cleanup on unmount (save one last time) disabled per user request
    const [isSyncScroll, setIsSyncScroll] = useState(true);

    const handleSyncScroll = (e: React.UIEvent<HTMLDivElement | HTMLTextAreaElement>, isLeft: boolean) => {
        if (!isSyncScroll) {
            // If sync is off, still update the highlight overlay for edit panel
            if (!isLeft && highlightOverlayRef.current) {
                highlightOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
            }
            return;
        }

        const source = e.currentTarget;
        const target = isLeft ? editPanelRef.current : rawPanelRef.current;
        const overlay = highlightOverlayRef.current;
        if (!target) return;
        
        // Calculate percentage to handle different heights if needed
        const percentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
        
        if (isLeft) {
            if (isSyncingLeft.current) { isSyncingLeft.current = false; return; }
            isSyncingRight.current = true;
            target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
        } else {
            if (isSyncingRight.current) { isSyncingRight.current = false; return; }
            isSyncingLeft.current = true;
            target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
            if (overlay) { overlay.scrollTop = source.scrollTop; }
        }
    };
    /* eslint-enable react-hooks/immutability */

    const handleSelection = (isLeft: boolean) => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (text) {
            if (isLeft) rawSelectionRef.current = text;
            else editSelectionRef.current = text;
            
            if (rawSelectionRef.current && editSelectionRef.current) {
                const newSel = { raw: rawSelectionRef.current, edit: editSelectionRef.current };
                setGlossarySelection(newSel);
                setEditingGlossary(newSel);
            }
        }
    };

    const handleRescueCopy = async () => {
        const localDict = optimizeDictionary(dictionary, file.content);
        let localContext = optimizeContext(storyInfoContext || "", file.content);
        if (typeof dedupeContextAgainstDictionary === 'function') {
            localContext = dedupeContextAgainstDictionary(localContext, localDict);
        }
        const rescuePrompt = `*** BẠN LÀ HỆ THỐNG CỨU HỘ DỊCH THUẬT ***\nHãy dịch nội dung sau sang tiếng Việt.\n[NGỮ CẢNH]:\n${localContext}\n[TỪ ĐIỂN]:\n${localDict}\n[YÊU CẦU]: ${promptTemplate}\n[NỘI DUNG RAW]:\n${file.content}`;
        try {
            await navigator.clipboard.writeText(rescuePrompt.trim());
            addToast("Đã copy gói cứu hộ! (Đã lọc Từ điển & Ngữ cảnh)", "success");
        } catch (err: any) {
            addToast(`Không thể copy vào clipboard (${err.message})`, "error");
        }
    };

    const copyTextToClipboard = async (text: string, successMsg: string) => {
        try {
            await navigator.clipboard.writeText(text);
            addToast(successMsg, "success");
        } catch (err: any) {
            addToast(`Không thể copy vào clipboard (${err?.message || 'trình duyệt chặn quyền truy cập'})`, "error");
        }
    };

    const handleSave = useCallback(() => {
        onSave(file.id, editContent);
    }, [onSave, file.id, editContent]);

    const handleSaveAndNext = useCallback(() => {
        onSaveAndNext(file.id, editContent);
    }, [onSaveAndNext, file.id, editContent]);

    const handleSaveAndPrev = useCallback(() => {
        if (onSaveAndPrev) onSaveAndPrev(file.id, editContent);
    }, [onSaveAndPrev, file.id, editContent]);

    const handleAddToGlossary = useCallback(() => {
        if (editingGlossary.raw && editingGlossary.edit) {
            onAddToGlossary(editingGlossary.raw, editingGlossary.edit);
            setGlossarySelection(null);
            rawSelectionRef.current = "";
            editSelectionRef.current = "";
        }
    }, [editingGlossary, onAddToGlossary]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSaveAndNext();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
                addToast("Đã lưu (Ctrl+S)", "success");
            }
            if (e.altKey && e.key === 'd') {
                e.preventDefault();
                handleAddToGlossary();
            }
            
            // Navigation with arrow keys
            // FIX (UX theo yêu cầu): trước đây ←/→ THƯỜNG cũng nhảy chương khi focus không nằm
            // trong ô nhập — dễ nhảy nhầm khi vừa bấm nút toolbar hoặc đang đọc panel Raw.
            // Giờ CHỈ Alt+←/→ mới điều hướng chương; phím mũi tên thường trả lại hành vi mặc định.
            if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                if (hasNext && onNext) onNext(file.id);
            }
            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                if (hasPrev && onPrev) onPrev(file.id);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, handleSaveAndNext, handleSaveAndPrev, handleAddToGlossary, addToast, hasNext, hasPrev, onNext, onPrev, file.id]);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm md:p-4 animate-in fade-in duration-200">
            {/* Full screen on Mobile (h-full w-full rounded-none) */}
            <div className="bg-white dark:bg-slate-900 md:rounded-3xl shadow-elevation-5 w-full h-full md:h-[92vh] max-w-7xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/20 dark:border-slate-700 ring-1 ring-black/5 rounded-none relative">
                
                {/* Header - Fixed Flex Layout for Horizontal Scrolling */}
                <div className={`px-3 py-2 md:px-4 md:py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0 z-30 gap-3 transition-all duration-300 ${isFocusMode ? '-mt-20 opacity-0 pointer-events-none' : 'opacity-100'}`}>
                    
                    {/* Title Section (Shrinks if needed) */}
                    <div className="flex items-center gap-2 md:gap-3 shrink overflow-hidden min-w-[50px] max-w-[30%]">
                        <div className="p-1.5 md:p-2 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-xl shrink-0 hidden sm:block"><Columns className="w-4 h-4 md:w-5 md:h-5" /></div>
                        <div className="min-w-0">
                            <h3 className="font-display font-bold text-sm md:text-lg text-slate-800 dark:text-slate-100 truncate">Biên Tập</h3>
                            <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-mono truncate hidden sm:block" title={file.name}>{file.name}</p>
                        </div>
                    </div>
                    
                    {/* Toolbar Actions - Scrollable Container */}
                    <div className="flex-1 flex justify-end min-w-0">
                        <div className="flex gap-2 items-center overflow-x-auto no-scrollbar scrollbar-none pr-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                            
                            {glossarySelection && (
                                <div className="flex items-center gap-1 mr-1 animate-in fade-in slide-in-from-top-2 bg-slate-50 dark:bg-slate-800 p-1 rounded-lg border border-slate-100 dark:border-slate-700 shrink-0">
                                    <div className="flex flex-col gap-0.5">
                                        <input className="w-16 md:w-24 text-[10px] border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 rounded px-1" value={editingGlossary.raw} onChange={e => setEditingGlossary(p => ({...p, raw: e.target.value}))} placeholder="Gốc" />
                                        <input className="w-16 md:w-24 text-[10px] border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 rounded px-1" value={editingGlossary.edit} onChange={e => setEditingGlossary(p => ({...p, edit: e.target.value}))} placeholder="Dịch" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                            <button onClick={handleAddToGlossary} className="p-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Thêm vào từ điển"><Link2 className="w-3 h-3" /></button>
                                            <button onClick={() => { onReplaceAll(editingGlossary.raw, editingGlossary.edit); setGlossarySelection(null); }} className="p-1 bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Thay thế toàn bộ"><Replace className="w-3 h-3" /></button>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center gap-1 md:gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shrink-0">
                                <button onClick={() => setCheckMode('none')} className={`px-2 md:px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ease-smooth whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${checkMode === 'none' ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-elevation-1' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>Edit</button>
                                
                                <div className="flex items-center bg-white dark:bg-slate-700 rounded-lg shadow-sm overflow-hidden">
                                    <button onClick={() => setCheckMode('raw')} className={`px-2 md:px-3 py-1.5 text-xs font-bold transition-all duration-200 ease-smooth flex items-center gap-1 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${checkMode === 'raw' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-800 shadow-none'}`}><Bug className="w-3 h-3" /> Raw</button>
                                    {checkMode === 'raw' && foreignCharIndices.length > 0 && (
                                        <div className="flex items-center border-l border-slate-200 dark:border-slate-600">
                                            <button onClick={() => scrollToForeignChar('prev')} className="px-1.5 py-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Lên"><ChevronUp className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => scrollToForeignChar('next')} className="px-1.5 py-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors duration-200 ease-smooth border-l border-slate-200 dark:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Xuống"><ChevronDown className="w-3.5 h-3.5" /></button>
                                        </div>
                                    )}
                                </div>

                                <button onClick={() => setCheckMode('dict')} className={`px-2 md:px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ease-smooth flex items-center gap-1 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${checkMode === 'dict' ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-elevation-1' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}><Link2 className="w-3 h-3" /> Dict</button>
                            </div>
                            
                            {/* Rescue Button */}
                            <button onClick={handleRescueCopy} className="flex px-3 py-2.5 bg-rose-100 dark:bg-rose-900/30 hover:bg-rose-200 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-xl font-bold transition-all duration-200 ease-smooth items-center gap-2 text-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Copy gói cứu hộ">
                                <LifeBuoy className="w-4 h-4" /> <span className="hidden sm:inline">Cứu Hộ</span>
                            </button>
                            
                            {/* Focus Mode Toggle */}
                            <button onClick={() => setIsFocusMode(true)} className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-slate-700 transition-all duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Chế độ tập trung (Ẩn công cụ)">
                                <Maximize2 className="w-4 h-4" />
                            </button>

                            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>

                            {/* Navigation Buttons */}
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shrink-0">
                                <button onClick={() => { if (hasPrev && onPrev) onPrev(file.id); }} disabled={!hasPrev} className={`p-1.5 rounded-lg transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${hasPrev ? 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 shadow-elevation-1' : 'text-slate-400 dark:text-slate-600 opacity-50 cursor-not-allowed'}`} title="Bỏ qua & Chương trước (Alt + ←)">
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button onClick={() => { if (hasNext && onNext) onNext(file.id); }} disabled={!hasNext} className={`p-1.5 rounded-lg transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${hasNext ? 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 shadow-elevation-1' : 'text-slate-400 dark:text-slate-600 opacity-50 cursor-not-allowed'}`} title="Bỏ qua & Chương tiếp (Alt + →)">
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="flex items-center gap-1 bg-primary-50 dark:bg-primary-900/30 p-1 rounded-xl shrink-0">
                                <button onClick={handleSaveAndPrev} disabled={!hasPrev} className={`p-1.5 rounded-lg transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${hasPrev ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 shadow-elevation-1' : 'text-primary-400 dark:text-primary-600 opacity-50 cursor-not-allowed'}`} title="Lưu & Chương trước">
                                    <div className="flex items-center"><Save className="w-3 h-3 mr-1"/><ChevronLeft className="w-4 h-4" /></div>
                                </button>
                                <button onClick={handleSaveAndNext} disabled={!hasNext} className={`p-1.5 rounded-lg transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${hasNext ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 shadow-elevation-1' : 'text-primary-400 dark:text-primary-600 opacity-50 cursor-not-allowed'}`} title="Lưu & Chương tiếp (Ctrl + Enter)">
                                    <div className="flex items-center"><Save className="w-3 h-3 mr-1"/><ChevronRight className="w-4 h-4" /></div>
                                </button>
                            </div>

                            <button onClick={handleSave} className="px-3 md:px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold shadow-glow-primary transition-all duration-200 ease-smooth flex items-center gap-2 text-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"><Save className="w-4 h-4" /> <span className="hidden sm:inline">Lưu</span></button>
                            <button onClick={onClose} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Đóng (Bỏ qua)"><X className="w-5 h-5" /></button>
                        </div>
                    </div>
                </div>
                
                {/* Floating Exit Focus Button */}
                {isFocusMode && (
                    <button 
                        onClick={() => setIsFocusMode(false)} 
                        className="absolute top-4 right-4 z-50 p-2 bg-slate-900/50 hover:bg-slate-900 text-white rounded-full backdrop-blur-sm transition-all duration-200 ease-smooth shadow-lg animate-in fade-in"
                        title="Thoát chế độ tập trung"
                    >
                        <Minimize2 className="w-5 h-5" />
                    </button>
                )}

                {/* Body - Improved layout for scrolling */}
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 relative overflow-hidden flex flex-col md:flex-row landscape:flex-row min-h-0">
                    {/* Raw Panel */}
                    <div className="flex-1 min-w-0 border-r border-slate-200/60 dark:border-slate-800/60 flex flex-col min-h-0 relative group/raw">
                        {/* Panel Header */}
                        <div className={`px-4 py-2.5 bg-slate-100/80 dark:bg-slate-900/80 border-b border-slate-200/60 dark:border-slate-800/60 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex justify-between items-center backdrop-blur-md shrink-0 transition-all duration-300 ${isFocusMode ? '-mt-10 opacity-0' : 'opacity-100'}`}>
                            <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Bản Gốc (Raw)</span>
                            <div className="flex gap-2">
                                <button onClick={() => setIsSyncScroll(!isSyncScroll)} className={`text-[10px] flex items-center gap-1 ${isSyncScroll ? 'text-primary-600 font-bold' : 'text-slate-400'}`} title={isSyncScroll ? "Tắt đồng bộ cuộn" : "Bật đồng bộ cuộn"}>
                                    {isSyncScroll ? <Lock className="w-3 h-3"/> : <Unlock className="w-3 h-3"/>} Sync
                                </button>
                                <button onClick={() => copyTextToClipboard(stripTitleAnchor(file.content), "Đã copy Raw")} className="text-[10px] text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"><Copy className="w-3 h-3"/> Copy</button>
                            </div>
                        </div>
                        
                        <div 
                            className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50/30 dark:bg-slate-950/30 custom-scrollbar touch-pan-y"
                            ref={rawPanelRef}
                            onScroll={(e) => handleSyncScroll(e, true)}
                            onMouseUp={() => handleSelection(true)}
                        >
                            <div className="whitespace-pre-wrap break-words font-content text-base leading-[1.8] text-slate-600 dark:text-slate-400 selection:bg-slate-200 dark:selection:bg-slate-700 pb-32">
                                {stripTitleAnchor(file.content)}
                            </div>
                        </div>
                    </div>

                    {/* Edit Panel */}
                    <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-white dark:bg-slate-900 relative group/editor">
                        {/* Panel Header */}
                        <div className={`px-4 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-wider flex justify-between items-center shrink-0 z-20 transition-all duration-300 ${isFocusMode ? '-mt-10 opacity-0' : 'opacity-100'}`}>
                            <span className="flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Bản Dịch (Editor)</span>
                            <button onClick={() => copyTextToClipboard(addBlankLineBetweenParagraphs(editContent), "Đã copy")} className="text-[10px] text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"><Copy className="w-3 h-3"/> Copy</button>
                        </div>
                        
                        {/* Container for Editor & Overlay */}
                        <div className="flex-1 relative min-h-0">
                            {checkMode === 'raw' && (
                                <div 
                                    ref={highlightOverlayRef}
                                    className="absolute inset-0 p-4 md:p-6 whitespace-pre-wrap break-words font-content text-lg leading-[1.8] text-transparent pointer-events-none z-0 overflow-hidden custom-scrollbar pb-32"
                                    aria-hidden="true"
                                >
                                    {rawHighlightSegments.map((seg, index) => (
                                        <span
                                            key={index}
                                            data-nav-index={seg.navIndex !== null ? seg.navIndex : undefined}
                                            className={seg.isForeign ? "bg-rose-500/40 dark:bg-rose-500/50 text-transparent border-b-2 border-rose-600 dark:border-rose-400" : "text-transparent"}
                                        >
                                            {seg.text}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {checkMode === 'dict' && dictRegex && (
                                <div 
                                    ref={highlightOverlayRef}
                                    className="absolute inset-0 p-4 md:p-6 whitespace-pre-wrap break-words font-content text-lg leading-[1.8] text-transparent pointer-events-none z-0 overflow-hidden custom-scrollbar pb-32"
                                    aria-hidden="true"
                                >
                                    {editContent.split(dictRegex).map((part, index) => {
                                        if (dictMap.has(part)) {
                                            return (
                                                <span key={index} className="bg-amber-300/40 dark:bg-amber-500/40 text-transparent border-b-2 border-amber-500 dark:border-amber-400 pointer-events-auto cursor-help" title={dictMap.get(part)}>
                                                    {part}
                                                </span>
                                            );
                                        }
                                        return <span key={index} className="text-transparent">{part}</span>;
                                    })}
                                </div>
                            )}
                            <textarea
                                className="absolute inset-0 w-full h-full p-4 md:p-6 bg-transparent resize-none outline-none break-words font-content text-lg leading-[1.8] text-slate-800 dark:text-slate-200 focus:bg-slate-50/30 dark:focus:bg-slate-800/30 transition-colors z-10 selection:bg-primary-100 dark:selection:bg-primary-900 custom-scrollbar pb-32 touch-pan-y"
                                value={editContent}
                                onChange={e => { isDirtyRef.current = true; setEditContent(e.target.value); }}
                                ref={editPanelRef}
                                onScroll={(e) => handleSyncScroll(e, false)}
                                onMouseUp={() => handleSelection(false)}
                                spellCheck={false}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
