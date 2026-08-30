
import React from 'react';
import { 
    ImageIcon, Upload, RefreshCw, Download, Sparkles, Loader2, 
    Archive, ArchiveRestore, Trash2, Globe, Tags, Users, Palette, Sword,
    Wand2, FileUp, GraduationCap, Check, ShieldAlert
} from 'lucide-react';
import { StoryInfo, FileItem } from '../types';
import { TagInput } from '../components/modals';
import { AutoBackupPanel } from './AutoBackupPanel';
import { AVAILABLE_LANGUAGES, AVAILABLE_GENRES, AVAILABLE_PERSONALITIES, AVAILABLE_SETTINGS, AVAILABLE_FLOWS } from '../constants';

interface DashboardPageProps {
    storyInfo: StoryInfo;
    setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    coverPreviewUrl: string | null;
    handleCoverUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleAutoAnalyze: () => void;
    isAutoAnalyzing: boolean;
    autoAnalyzeStatus: string;
    quickInput: string;
    setQuickInput: (v: string) => void;
    handleQuickParse: () => void;
    handleRegenerateCover: () => void;
    isGeneratingCover: boolean;
    handleBackup: () => void;
    handleRestore: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    requestResetApp: () => void;
    handleResetQuota: () => void;
    setShowGuide: (v: boolean) => void;
    handleRefineSummary: () => void;
    // Đề xuất cải thiện tồn đọng: banner "cứu hộ" trước đây chỉ hiện ở Workspace, người dùng
    // không thấy ngay nếu chưa mở tab đó. `files` optional để không phá các nơi gọi
    // DashboardPage khác (nếu có) chưa truyền prop này.
    files?: FileItem[];
}

export const DashboardPage: React.FC<DashboardPageProps> = (props) => {
    
    const handleDownloadCover = (e: React.MouseEvent) => {
        e.preventDefault();
        if (props.coverPreviewUrl) {
            const link = document.createElement('a');
            link.href = props.coverPreviewUrl;
            link.download = `Cover_${props.storyInfo.title || 'AI_Art'}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const rescueLockedCount = (props.files || []).filter(f => f.isRescueLocked).length;

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Chỉ báo diện "cứu hộ" (đề xuất cải thiện tồn đọng) - trước đây chỉ hiện trên
                Workspace, người dùng không thấy ngay nếu chưa mở tab đó. Chỉ hiện gọn 1 dòng,
                không lặp lại toàn bộ chi tiết banner Workspace. */}
            {rescueLockedCount > 0 && (
                <div className="px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {rescueLockedCount} tệp đang ở diện cứu hộ — xem chi tiết ở tab Workspace.
                    </span>
                </div>
            )}
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-xl md:text-2xl font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <FileUp className="w-6 h-6 text-primary-500" /> Thông Tin Tác Phẩm
                </h2>
                <button onClick={() => props.setShowGuide(true)} className="px-4 py-2 bg-white dark:bg-slate-800 border border-primary-200 dark:border-primary-900 text-primary-600 dark:text-primary-400 rounded-xl font-bold text-sm hover:bg-primary-50 dark:hover:bg-primary-900/50 transition-colors duration-200 ease-smooth shadow-elevation-1 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                    <GraduationCap className="w-4 h-4" /> Hướng Dẫn Sử Dụng
                </button>
            </div>

            {/* Main Compact Card */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="flex flex-col md:flex-row gap-6">
                    
                    {/* Compact Cover Section (Fixed Width on Desktop) */}
                    <div className="w-full md:w-48 shrink-0 flex flex-col gap-3">
                        <div className="aspect-[2/3] w-full bg-slate-50 dark:bg-slate-800 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 relative overflow-hidden group hover:border-primary-300 dark:hover:border-primary-700 transition-colors shadow-inner">
                            {props.isGeneratingCover && (
                                <div className="absolute inset-0 z-20 bg-white/80 dark:bg-slate-900/80 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                                    <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                                    <span className="text-[10px] font-bold text-primary-600">Đang vẽ...</span>
                                </div>
                            )}
                            
                            {props.coverPreviewUrl ? (
                                <img src={props.coverPreviewUrl} alt="Cover" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
                                    <ImageIcon className="w-8 h-8 mb-2" />
                                    <span className="text-[10px] font-bold uppercase text-center px-2">Chưa có ảnh</span>
                                </div>
                            )}

                            {/* Hover Actions */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-10 p-2">
                                <label className="w-full py-1.5 bg-white/20 hover:bg-white text-white hover:text-slate-900 rounded-lg cursor-pointer text-[10px] font-bold backdrop-blur-md transition-all flex items-center justify-center gap-1">
                                    <Upload className="w-3 h-3" /> Tải Lên
                                    <input type="file" accept="image/*" className="hidden" onChange={props.handleCoverUpload} />
                                </label>

                                <button onClick={props.handleRegenerateCover} disabled={props.isGeneratingCover} className="w-full py-1.5 bg-primary-600/80 hover:bg-primary-500 text-white rounded-lg cursor-pointer text-[10px] font-bold backdrop-blur-md transition-all flex items-center justify-center gap-1 disabled:opacity-50">
                                    {props.isGeneratingCover ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 
                                    {props.isGeneratingCover ? "Đang tạo..." : "Tạo Lại (AI)"}
                                </button>

                                {props.coverPreviewUrl && (
                                    <button onClick={handleDownloadCover} className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer text-[10px] font-bold shadow-lg transition-all flex items-center justify-center gap-1">
                                        <Download className="w-3 h-3" /> Lưu
                                    </button>
                                )}
                            </div>
                        </div>

                         <button onClick={props.handleAutoAnalyze} disabled={props.isAutoAnalyzing} className="w-full py-2.5 bg-gradient-to-r from-primary-500 to-purple-600 hover:from-primary-400 hover:to-purple-500 text-white rounded-xl text-xs font-bold shadow-md shadow-primary-200/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                            {props.isAutoAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} 
                            {props.isAutoAnalyzing ? "Đang xử lý..." : "Auto Phân Tích"}
                        </button>
                    </div>

                    {/* Info Inputs Section */}
                    <div className="flex-1 flex flex-col gap-4 max-w-2xl">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 block ml-1">Tên Truyện</label>
                                <input type="text" className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-bold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 focus:bg-white dark:focus:bg-slate-900 transition-all shadow-sm" value={props.storyInfo.title || ''} onChange={e => props.setStoryInfo({...props.storyInfo, title: e.target.value})} placeholder="Nhập tên truyện..." />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 block ml-1">Tác Giả</label>
                                <input type="text" className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-medium text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 focus:bg-white dark:focus:bg-slate-900 transition-all shadow-sm" value={props.storyInfo.author || ''} onChange={e => props.setStoryInfo({...props.storyInfo, author: e.target.value})} placeholder="Tên tác giả..." />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase ml-1">Tóm Tắt / Review (Summary)</label>
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.handleRefineSummary(); }} className="shrink-0 whitespace-nowrap text-xs flex items-center gap-1 font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-2 py-1 rounded-md hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                                    {/* FIX (check sai trường): nút này sinh `summary` từ
                                        `contextNotes`, nhưng dấu tích từng đọc `contextNotes` —
                                        hiện "đã có" dù summary trống, và không hiện khi chỉ có
                                        summary. Đọc đúng trường mà nút tạo ra. */}
                                    <Sparkles className="w-3 h-3" /> Tinh Chỉnh {props.storyInfo.summary ? <Check className="w-3 h-3 text-emerald-500 inline-block ml-0.5" /> : ''}
                                </button>
                            </div>
                            <textarea className="w-full h-20 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-300 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 focus:bg-white dark:focus:bg-slate-900 transition-all resize-none custom-scrollbar" placeholder="Nội dung tóm tắt hoặc review chi tiết (Dùng cho tạo bìa và giới thiệu Ebook)..." value={props.storyInfo.summary || ''} onChange={e => props.setStoryInfo({...props.storyInfo, summary: e.target.value})} />
                        </div>

                        <div className="relative">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 block ml-1">Nhập nhanh Thẻ (Paste Text)</label>
                            <input type="text" className="w-full pl-4 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-slate-300 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all shadow-sm" placeholder="VD: Tiên Hiệp, Hệ Thống, Hài Hước..." value={props.quickInput} onChange={e => props.setQuickInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), props.handleQuickParse())} />
                            <button onClick={props.handleQuickParse} className="absolute bottom-1.5 right-1.5 p-1.5 bg-primary-100 hover:bg-primary-200 dark:bg-primary-900 dark:hover:bg-primary-800 text-primary-600 dark:text-primary-300 rounded-lg transition-colors"><Wand2 className="w-4 h-4" /></button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Classification */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                <h3 className="text-lg font-display font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <Tags className="w-5 h-5 text-emerald-500" /> Phân Loại Chi Tiết
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <TagInput label="Ngôn ngữ truyện" icon={<Globe className="w-3.5 h-3.5" />} options={AVAILABLE_LANGUAGES} selected={props.storyInfo.languages} onChange={v => props.setStoryInfo({...props.storyInfo, languages: v})} placeholder="Chọn..." />
                    <TagInput label="Thể loại" icon={<Tags className="w-3.5 h-3.5" />} options={AVAILABLE_GENRES} selected={props.storyInfo.genres} onChange={v => props.setStoryInfo({...props.storyInfo, genres: v})} placeholder="+ Thể loại"/>
                    <TagInput label="Tính cách Main" icon={<Users className="w-3.5 h-3.5" />} options={AVAILABLE_PERSONALITIES} selected={props.storyInfo.mcPersonality} onChange={v => props.setStoryInfo({...props.storyInfo, mcPersonality: v})} placeholder="+ Tính cách"/>
                    <TagInput label="Bối cảnh" icon={<Palette className="w-3.5 h-3.5" />} options={AVAILABLE_SETTINGS} selected={props.storyInfo.worldSetting} onChange={v => props.setStoryInfo({...props.storyInfo, worldSetting: v})} placeholder="+ Bối cảnh"/>
                    <TagInput label="Lưu phái" icon={<Sword className="w-3.5 h-3.5" />} options={AVAILABLE_FLOWS} selected={props.storyInfo.sectFlow} onChange={v => props.setStoryInfo({...props.storyInfo, sectFlow: v})} placeholder="+ Lưu phái"/>
                </div>
            </div>

            {/* Core Settings */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                <h3 className="text-lg font-display font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-primary-500" /> Cài Đặt Biên Tập & Format
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div className="space-y-4">
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative">
                                <input type="checkbox" className="sr-only peer" checked={props.storyInfo.enableTitleFormatting ?? true} onChange={(e) => props.setStoryInfo({ ...props.storyInfo, enableTitleFormatting: e.target.checked })} />
                                <div className={`block w-10 h-6 rounded-full transition-colors duration-200 ease-smooth peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-900 ${props.storyInfo.enableTitleFormatting !== false ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform transform ${props.storyInfo.enableTitleFormatting !== false ? 'translate-x-4' : ''}`}></div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">Bật chuẩn hóa tiêu đề</span>
                                <span className="text-[10px] text-slate-500">Tắt nếu muốn giữ nguyên tiêu đề gốc hoàn toàn, không xóa rác trước tiêu đề.</span>
                            </div>
                        </label>
                        
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative">
                                <input type="checkbox" className="sr-only peer" checked={props.storyInfo.enableAutoFormat ?? true} onChange={(e) => props.setStoryInfo({ ...props.storyInfo, enableAutoFormat: e.target.checked })} />
                                <div className={`block w-10 h-6 rounded-full transition-colors duration-200 ease-smooth peer-focus-visible:ring-2 peer-focus-visible:ring-pink-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-900 ${props.storyInfo.enableAutoFormat !== false ? 'bg-pink-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform transform ${props.storyInfo.enableAutoFormat !== false ? 'translate-x-4' : ''}`}></div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-pink-600 dark:group-hover:text-pink-400">Bật định dạng và lọc rác</span>
                                <span className="text-[10px] text-slate-500">Tự động sửa lỗi dòng văn bản, lọc kí tự rác, không ảnh hưởng đến tiêu đề.</span>
                            </div>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative">
                                <input type="checkbox" className="sr-only peer" checked={props.storyInfo.enableGarbageCleanOnImport ?? true} onChange={(e) => props.setStoryInfo({ ...props.storyInfo, enableGarbageCleanOnImport: e.target.checked })} />
                                <div className={`block w-10 h-6 rounded-full transition-colors duration-200 ease-smooth peer-focus-visible:ring-2 peer-focus-visible:ring-teal-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-900 ${props.storyInfo.enableGarbageCleanOnImport !== false ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform transform ${props.storyInfo.enableGarbageCleanOnImport !== false ? 'translate-x-4' : ''}`}></div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-teal-600 dark:group-hover:text-teal-400">Lọc rác sơ bộ ngay lúc thêm file</span>
                                <span className="text-[10px] text-slate-500">Tự động xóa thẻ HTML rác, ký tự *#= trơ trọi, chuỗi __/-- lặp... ngay khi thêm file ZIP/EPUB/DOCX/TXT/PDF, không cần chờ mở Bộ Tách Chương.</span>
                            </div>
                        </label>

                        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                            <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1">Kiểu hiển thị tiêu đề</label>
                            <select 
                                value={props.storyInfo.titleFormat || 'colon'} 
                                onChange={e => props.setStoryInfo({ ...props.storyInfo, titleFormat: e.target.value as any })}
                                className="w-full text-sm font-medium px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                disabled={props.storyInfo.enableTitleFormatting === false}
                            >
                                <option value="colon">Dấu hai chấm (Chương 1: Tiêu đề)</option>
                                <option value="dash">Dấu gạch ngang (Chương 1 — Tiêu đề)</option>
                                <option value="newline">Kéo xuống dòng (Chương 1 \n Tiêu đề)</option>
                                <option value="bracket">Dạng Ngoặc ([Chương 1]: Tiêu đề)</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                         <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block">Định dạng thẻ khóa file (Tag Format) trong Prompt</label>
                         <p className="text-[10px] text-slate-500 mb-2">Tự động chọn định dạng tag tối ưu cho từng Model (VD: 2.5 Pro hỗ trợ XML tốt hơn).</p>
                         <div className="flex flex-wrap items-center gap-4">
                             <label className="flex items-center gap-2 cursor-pointer">
                                 <input type="radio" name="tagFormat" className="text-primary-600 focus:ring-primary-500" checked={props.storyInfo.tagFormat === 'auto' || !props.storyInfo.tagFormat} onChange={() => props.setStoryInfo({ ...props.storyInfo, tagFormat: 'auto' })} />
                                 <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Tùy chọn tự động (khuyên dùng)</span>
                             </label>
                             <label className="flex items-center gap-2 cursor-pointer">
                                 <input type="radio" name="tagFormat" className="text-primary-600 focus:ring-primary-500" checked={props.storyInfo.tagFormat === 'bracket'} onChange={() => props.setStoryInfo({ ...props.storyInfo, tagFormat: 'bracket' })} />
                                 <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Ngoặc vuông <code>[[[FILE]]]</code></span>
                             </label>
                             <label className="flex items-center gap-2 cursor-pointer">
                                 <input type="radio" name="tagFormat" className="text-primary-600 focus:ring-primary-500" checked={props.storyInfo.tagFormat === 'xml'} onChange={() => props.setStoryInfo({ ...props.storyInfo, tagFormat: 'xml' })} />
                                 <span className="text-sm font-medium text-slate-600 dark:text-slate-300">XML <code>&lt;FILE&gt;</code></span>
                             </label>
                         </div>
                    </div>
                </div>
            </div>

            {/* System Tools */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">                <button onClick={props.handleBackup} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 p-4 rounded-2xl font-bold text-sm transition-all duration-200 ease-smooth flex items-center justify-center gap-3 border border-slate-200 dark:border-slate-800 shadow-elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 group">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 group-hover:text-primary-500 transition-colors"><Archive className="w-5 h-5" /></div>
                    Backup (.json)
                </button>
                <label className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 p-4 rounded-2xl font-bold text-sm transition-all duration-200 ease-smooth flex items-center justify-center gap-3 border border-slate-200 dark:border-slate-800 shadow-elevation-1 cursor-pointer group focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-1">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 group-hover:text-emerald-500 transition-colors"><ArchiveRestore className="w-5 h-5" /></div>
                    Restore Data
                    <input type="file" accept=".json" className="hidden" onChange={props.handleRestore} />
                </label>
                <button onClick={props.handleResetQuota} className="bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-900/10 text-amber-600 dark:text-amber-400 p-4 rounded-2xl font-bold text-sm transition-all duration-200 ease-smooth flex items-center justify-center gap-3 border border-amber-100 dark:border-amber-900/30 shadow-elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 group">
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/30 rounded-full text-amber-400 group-hover:text-amber-600 transition-colors"><RefreshCw className="w-5 h-5" /></div>
                    Reset Quota
                </button>
                <button onClick={props.requestResetApp} className="bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-900/10 text-rose-600 dark:text-rose-400 p-4 rounded-2xl font-bold text-sm transition-all duration-200 ease-smooth flex items-center justify-center gap-3 border border-rose-100 dark:border-rose-900/30 shadow-elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 group">
                    <div className="p-2 bg-rose-50 dark:bg-rose-900/30 rounded-full text-rose-400 group-hover:text-rose-600 transition-colors"><Trash2 className="w-5 h-5" /></div>
                    Reset Toàn Bộ App
                </button>
            </div>

            {/* NÂNG CẤP #10 — Bản dự phòng tự động (IndexedDB, giữ 5 bản gần nhất) */}
            <AutoBackupPanel />
        </div>
    );
};
