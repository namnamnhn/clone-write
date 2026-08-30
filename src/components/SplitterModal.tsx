
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { FileItem, FileStatus } from '../types';
import { splitContentByRegex, splitContentByLength, stripTitleAnchor } from '../utils/fileHelpers';

export interface SplitterModalProps {
    isOpen: boolean;
    fileContent: string;
    fileName: string;
    isTranslatedImport?: boolean;
    onConfirmSplit: (files: FileItem[]) => void;
    onCancel: () => void;
}

export const SplitterModal: React.FC<SplitterModalProps> = ({ isOpen, fileContent, fileName, isTranslatedImport, onConfirmSplit, onCancel }) => { 
    const [mode, setMode] = useState<'regex' | 'preserve' | 'reindex'>('regex'); 
    const [charLimit, setCharLimit] = useState<number>(5000); 
    const [customRegex, setCustomRegex] = useState<string>(''); 
    const [embedTitleAnchor, setEmbedTitleAnchor] = useState<boolean>(true);
    const [cleanGarbage, setCleanGarbage] = useState<boolean>(true);
    const [previewFiles, setPreviewFiles] = useState<FileItem[]>([]);
    const [isCalculating, setIsCalculating] = useState(true); 
    
    const REGEX_PRESETS = [
        { label: "Thông Minh (Đa năng)", value: "" },
        { label: "Số La Mã (I, II, III...)", value: "^(?:(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))(?:\\s*[.:\\-—]|\\s+\\S)" },
        { label: "Số thứ tự (001. 002.)", value: "^\\s*\\d{2,4}[.、．]\\s*\\S" },
        { label: "Tiếng Anh (Roman/Word)", value: "^(?:(?:Chapter|Part|Book|Vol|Episode)\\s+(?:[IVXLCDM]+|\\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Twenty)|(?:[IVXLCDM]+|(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Twenty))\\s*[:.])\\s*.*$" },
        // Nhiều PDF/Word Nhật đánh số chương theo dạng `１４７：Tiêu đề`. Chấp nhận cả :/：,
        // nhưng không coi `１２：３０` là chương (ký tự đầu sau dấu hai chấm không được là số).
        { label: "Truyện Nhật (Syosetu)", value: "^(?:[#＃][0-9０-９]+|第\\s*[0-9０-９]+\\s*[話章幕節]|[0-9０-９]+\\s*(?:[.．](?![\\s]*[\"'“‘«「『【《])|[:：](?=\\s*[^\\s0-9０-９])))\\s*.*$" }, 
        { label: "Trung/Hàn (Đa Năng)", value: "^\\s*(?:(?:【[^】]*】|\\[[^\\]]*\\]|《[^》]*》|「[^」]*」|『[^』]*』|<[^>]*>|(?:第\\s*[0-9０-９零〇一二三四五六七八九十百千万萬两兩]+\\s*[卷部])|[0-9０-９]+[\\s\\-.、_]+)\\s*)*(?:(?:第|제)?\\s*[0-9０-９零〇一二三四五六七八九十百千万萬兩两]+\\s*[章回节節卷集話话幕部화장편]|\\d+\\s*[화장편]).*$" },
        { label: "Việt/Anh (Chương X)", value: "^(?:Chương|Hồi|Phần|Quyển|Tập|Chapter|Volume|Book|Part)\\s*\\d+.*$" },
    ];

    useEffect(() => { 
        if (!isOpen) return; 
        const timer = setTimeout(() => { 
            let resultFiles: FileItem[] = [];
            if (mode === 'regex') { 
                resultFiles = splitContentByRegex(fileContent, customRegex, cleanGarbage); 
            } else { 
                resultFiles = splitContentByLength(fileContent, charLimit, mode === 'reindex' ? 'reindex' : 'preserve', embedTitleAnchor, cleanGarbage); 
            }
            if (isTranslatedImport) {
                resultFiles = resultFiles.map(f => ({
                    ...f,
                    translatedContent: f.content,
                    status: FileStatus.COMPLETED
                }));
            }
            setPreviewFiles(resultFiles); 
            setIsCalculating(false); 
        }, 500); 
        return () => clearTimeout(timer); 
    }, [isOpen, mode, charLimit, customRegex, embedTitleAnchor, cleanGarbage, fileContent, isTranslatedImport]); 

    const handleConfirm = () => { 
        onConfirmSplit(previewFiles);
    }; 
    
    const handleKeepAsIs = () => { 
        const file: FileItem = { id: crypto.randomUUID(), name: fileName, content: fileContent, translatedContent: isTranslatedImport ? fileContent : null, status: isTranslatedImport ? FileStatus.COMPLETED : FileStatus.IDLE, retryCount: 0, originalCharCount: fileContent.length, remainingRawCharCount: 0 }; 
        onConfirmSplit([file]); 
    }; 
    
    if (!isOpen) return null; 

    return ( 
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"> 
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-elevation-5 border border-transparent dark:border-slate-700 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"> 
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 shrink-0 overflow-y-auto max-h-[50vh] custom-scrollbar"> 
                    <h3 className="text-lg font-display font-bold text-slate-800 dark:text-slate-100">Bộ Tách Chương (Splitter v2.4 - Regex+)</h3> 
                    <div className="space-y-4 mt-4"> 
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1"> 
                            <button onClick={() => setMode('regex')} className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${mode === 'regex' ? 'bg-white dark:bg-slate-700 text-info-600 dark:text-info-400 shadow-elevation-1' : 'text-slate-500 dark:text-slate-400'}`}>Regex (Smart)</button> 
                            <button onClick={() => setMode('preserve')} className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${mode === 'preserve' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-elevation-1' : 'text-slate-500 dark:text-slate-400'}`}>Cắt Đoạn</button> 
                            <button onClick={() => setMode('reindex')} className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${mode === 'reindex' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-elevation-1' : 'text-slate-500 dark:text-slate-400'}`}>Cắt & Đánh Số</button> 
                        </div> 
                        
                        {mode === 'regex' ? ( 
                            <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700"> 
                                <div className="flex flex-wrap gap-2"> 
                                    {REGEX_PRESETS.map((preset, idx) => ( 
                                        <button key={idx} onClick={() => setCustomRegex(preset.value)} className={`px-2 py-1 text-[10px] font-bold rounded-md border transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${customRegex === preset.value ? 'bg-info-100 dark:bg-info-900/40 text-info-700 dark:text-info-400 border-info-300 dark:border-info-700' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-info-300 hover:text-info-600 dark:hover:text-info-400'}`} > {preset.label} </button> 
                                    ))} 
                                </div> 
                                <div className="flex gap-2 items-center">
                                    <input type="text" className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-mono shadow-elevation-1 focus:ring-2 focus:ring-info-200 dark:focus:ring-info-800 outline-none transition-all duration-200 ease-smooth" placeholder="Regex tùy chỉnh (để trống sẽ dùng tự động nhận diện)..." value={customRegex} onChange={e => setCustomRegex(e.target.value)} /> 
                                </div>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                    {customRegex === "" 
                                        ? "Đang dùng Smart Regex: Tự động phát hiện hầu hết các định dạng phổ biến (Chương, Hồi, Chap, 第...章, v.v.)" 
                                        : "Tùy chỉnh biểu thức Regex của bạn."}
                                </p> 
                            </div> 
                        ) : ( 
                            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700"> 
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">{mode === 'preserve' ? 'Cắt nhỏ file theo ký tự, GIỮ NGUYÊN nội dung.' : 'Cắt nhỏ, XÓA tiêu đề cũ và tự động thêm "Chương 1, 2..."'}</p> 
                                <input type="number" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs shadow-elevation-1 focus:ring-2 focus:ring-info-200 dark:focus:ring-info-800 outline-none transition-all duration-200 ease-smooth" value={charLimit} onChange={e => setCharLimit(parseInt(e.target.value) || 5000)} step={5000} min={1000} /> 
                                {mode === 'preserve' && (
                                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                                        <input type="checkbox" checked={embedTitleAnchor} onChange={(e) => setEmbedTitleAnchor(e.target.checked)} className="rounded text-info-500 focus:ring-info-500 dark:bg-slate-800 dark:border-slate-600" />
                                        <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">☑️ Đánh dấu và bảo toàn nguyên trạng tiêu đề gốc (Title Anchor)</span>
                                    </label>
                                )}
                            </div> 
                        )} 
                        
                        <label className="flex items-start gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" checked={cleanGarbage} onChange={(e) => setCleanGarbage(e.target.checked)} className="mt-0.5 rounded text-info-500 focus:ring-info-500 dark:bg-slate-800 dark:border-slate-600" />
                            <span className="text-xs">
                                <span className="font-bold text-slate-700 dark:text-slate-200">☑️ Lọc rác sơ bộ trong nội dung chương (thẻ HTML, *, #, =, chuỗi _ / - lặp, chuẩn hoá ...)</span>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Xóa thẻ HTML rác (&lt;i&gt;&lt;/i&gt;&lt;i&gt;&lt;/i&gt;...); xóa hẳn *, #, =; xóa chuỗi _ hoặc - lặp từ 2 lần trở lên (liên tục hoặc cách quãng); rút gọn ...... / …… (≥4 chấm) còn ...; rút gọn !!!! (≥4 dấu) còn !!!</p>
                            </span>
                        </label> 

                        <div className="flex justify-between items-center px-4 py-3 bg-primary-50 dark:bg-primary-900/20 rounded-xl border border-primary-100 dark:border-primary-800/50"> 
                            <span className="text-xs font-bold text-primary-700 dark:text-primary-400">Dự kiến:</span> 
                            <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{isCalculating ? <Loader2 className="w-4 h-4 animate-spin" /> : `${previewFiles.length} phần`}</span> 
                        </div> 
                    </div> 
                </div> 

                {/* PREVIEW LIST */}
                <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950/40 p-4 border-b border-slate-100 dark:border-slate-800 custom-scrollbar min-h-[100px]">
                    <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Xem trước ({previewFiles.length})</h4>
                    {previewFiles.length > 0 ? (
                        <div className="space-y-1">
                            {previewFiles.slice(0, 100).map((file, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-900 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 shadow-elevation-1 flex flex-col gap-1">
                                    <div className="font-bold text-slate-700 dark:text-slate-200 truncate">
                                        <span className="font-mono text-primary-500 dark:text-primary-400 mr-2">{String(idx+1).padStart(3, '0')}</span>
                                        {file.name}
                                    </div>
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-2 italic">
                                        {stripTitleAnchor(file.content).substring(0, 150)}...
                                    </div>
                                </div>
                            ))}
                            {previewFiles.length > 100 && (
                                <div className="text-center text-xs text-slate-400 dark:text-slate-500 italic py-2">
                                    ...và {previewFiles.length - 100} chương khác
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs italic">
                            Chưa tìm thấy chương nào phù hợp...
                        </div>
                    )}
                </div>

                <div className="p-6 shrink-0 flex flex-col gap-3 bg-white dark:bg-slate-900"> 
                    <div className="grid grid-cols-2 gap-3"> 
                        <button onClick={onCancel} className="py-3 text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">Hủy</button> 
                        <button onClick={handleConfirm} disabled={previewFiles.length === 0} className="py-3 bg-info-500 hover:bg-info-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-glow-primary transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-400 focus-visible:ring-offset-1"> Thực Hiện </button> 
                    </div> 
                    <button onClick={handleKeepAsIs} className="w-full py-2 text-xs font-bold text-primary-500 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-xl border border-dashed border-primary-200 dark:border-primary-800 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">Nhập Nguyên Bản (Không Tách)</button> 
                </div> 
            </div> 
        </div> 
    ); 
};
