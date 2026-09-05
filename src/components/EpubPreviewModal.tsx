
import React, { useState, useEffect } from 'react';
import { X, Book, User, FileText, Loader2, Upload, Type, Sparkles, Image as ImageIcon } from 'lucide-react';
import { StoryInfo, EpubDesignOptions, EpubDesignAssets, DEFAULT_EPUB_DESIGN_OPTIONS, EMPTY_EPUB_DESIGN_ASSETS } from '../types';

interface EpubPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (info: StoryInfo, cover: File | null, font: File | null, designOptions: EpubDesignOptions, designAssets: EpubDesignAssets) => void | Promise<void>;
    onRegenerateCover?: (info: StoryInfo) => Promise<File | null>;
    storyInfo: StoryInfo;
    coverImage: File | null;
    totalFiles: number;
    publicationNotice?: string;
}

type EpubTab = 'info' | 'font' | 'design';

// Ô chọn file nhỏ dùng chung cho Font/Design tab — hiện tên file đã chọn + nút xóa.
const FilePicker: React.FC<{
    label: string; accept: string; file: File | null; onChange: (f: File | null) => void; hint?: string;
}> = ({ label, accept, file, onChange, hint }) => (
    <div className="space-y-2">
        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" /> {label}
        </label>
        <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl cursor-pointer transition-colors text-sm font-medium border border-slate-200 dark:border-slate-700">
                <Upload className="w-4 h-4" />
                Chọn file
                <input
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => { if (e.target.files && e.target.files[0]) onChange(e.target.files[0]); }}
                />
            </label>
            {file && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 rounded-lg border border-emerald-100 dark:border-emerald-800">
                    <span className="truncate max-w-[150px]" title={file.name}>{file.name}</span>
                    <button onClick={() => onChange(null)} className="hover:text-emerald-700 dark:hover:text-emerald-300"><X className="w-4 h-4" /></button>
                </div>
            )}
        </div>
        {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
);

export const EpubPreviewModal: React.FC<EpubPreviewModalProps> = ({ 
    isOpen, onClose, onConfirm, onRegenerateCover, storyInfo, coverImage, totalFiles, publicationNotice
}) => {
    const [activeTab, setActiveTab] = useState<EpubTab>('info');
    const [localInfo, setLocalInfo] = useState<StoryInfo>(storyInfo);
    const [localCover, setLocalCover] = useState<File | null>(coverImage);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [localFont, setLocalFont] = useState<File | null>(null); // giữ tương thích cũ (dùng làm content font nếu chưa chọn contentFont riêng)
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);

    const [design, setDesign] = useState<EpubDesignOptions>(DEFAULT_EPUB_DESIGN_OPTIONS);
    const [assets, setAssets] = useState<EpubDesignAssets>(EMPTY_EPUB_DESIGN_ASSETS);

    // Modal có state cục bộ để người dùng thử đổi bìa trước khi xuất. Mỗi lần mở lại phải lấy
    // đúng bìa hiện hành từ app; nếu không instance/modal cache có thể tiếp tục giữ File cũ dù
    // bìa Dashboard đã được thay.
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => setLocalCover(coverImage), 0);
        return () => clearTimeout(timer);
    }, [isOpen, coverImage]);

    useEffect(() => {
        let url: string | null = null;
        if (localCover) {
            url = URL.createObjectURL(localCover);
            // Use timeout to avoid synchronous setState in effect
            const timer = setTimeout(() => setCoverPreview(url), 0);
            return () => {
                clearTimeout(timer);
                if (url) URL.revokeObjectURL(url);
            };
        } else {
            // Use timeout to avoid synchronous setState in effect
            const timer = setTimeout(() => setCoverPreview(null), 0);
            return () => clearTimeout(timer);
        }
    }, [localCover]);

    const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setLocalCover(e.target.files[0]);
        }
    };

    const handleRegenerate = async () => {
        if (!onRegenerateCover) return;
        setIsRegenerating(true);
        try {
            const newCover = await onRegenerateCover(localInfo);
            if (newCover) {
                setLocalCover(newCover);
            }
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleConfirm = async () => {
        if (isConfirming) return;
        setIsConfirming(true);
        try {
            await onConfirm(localInfo, localCover, localFont, design, assets);
        } finally {
            setIsConfirming(false);
        }
    };

    if (!isOpen) return null;

    const tabs: { id: EpubTab; label: string; icon: React.ReactNode }[] = [
        { id: 'info', label: 'Thông Tin', icon: <FileText className="w-3.5 h-3.5" /> },
        { id: 'font', label: 'Font Chữ', icon: <Type className="w-3.5 h-3.5" /> },
        { id: 'design', label: 'Thiết Kế', icon: <Sparkles className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            {/* Reduced max-h to 85vh to ensure footer visibility on smaller screens */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl overflow-y-auto md:overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20 dark:border-slate-700 flex flex-col md:flex-row max-h-[90vh] md:max-h-[85vh]">
                
                {/* Left Side: Cover Preview */}
                <div className="w-full md:w-1/3 bg-slate-100 dark:bg-slate-950 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 relative shrink-0">
                    <div className="aspect-[2/3] w-full max-w-[200px] bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden border-4 border-white dark:border-slate-700 relative group">
                        {coverPreview ? (
                            <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                <Book className="w-12 h-12 mb-2 opacity-50" />
                                <span className="text-xs font-bold uppercase">Chưa có bìa</span>
                            </div>
                        )}
                        
                        <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer text-white">
                            <Upload className="w-8 h-8 mb-2" />
                            <span className="text-xs font-bold uppercase">Đổi Ảnh Bìa</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
                        </label>
                    </div>
                    {onRegenerateCover && (
                        <button 
                            onClick={handleRegenerate}
                            disabled={isRegenerating}
                            className={`mt-4 px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center gap-2
                                ${isRegenerating 
                                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500' 
                                    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50'
                                }`}
                        >
                            {isRegenerating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                                    Đang tạo...
                                </>
                            ) : (
                                <>
                                    <Book className="w-4 h-4" />
                                    {localCover ? "Tạo Lại Ảnh Bìa (AI)" : "Tạo Ảnh Bìa (AI)"}
                                </>
                            )}
                        </button>
                    )}
                    <p className="mt-4 text-xs text-slate-500 text-center px-4">
                        Ảnh bìa sẽ được nhúng vào file EPUB. Tỉ lệ khuyến nghị 2:3.<br/>
                        <span className="text-amber-600 dark:text-amber-500 mt-1 block">Lưu ý: AI hiện tại (Midjourney, Gemini...) thường vẽ sai dấu tiếng Việt. Nếu ảnh bị lỗi chữ, bạn nên dùng ảnh không chữ (clean art) và thêm text bằng Canva/Photoshop.</span>
                    </p>
                </div>

                {/* Right Side: Metadata Form - Added min-h-0 to allow proper scrolling */}
                <div className="flex-none md:flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                    <div className="p-6 pb-0 border-b border-slate-100 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-900/10 shrink-0">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <Book className="w-6 h-6 text-rose-500" /> Xuất Bản Ebook (EPUB)
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Chuẩn Google Play Books & Kindle. Tự động làm sạch & tạo mục lục.
                                </p>
                                {publicationNotice && <p className="mt-2 max-w-xl text-xs font-bold leading-relaxed text-rose-700 dark:text-rose-300">{publicationNotice}</p>}
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex gap-1 mt-4">
                            {tabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setActiveTab(t.id)}
                                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2
                                        ${activeTab === t.id
                                            ? 'text-rose-600 dark:text-rose-400 border-rose-500 bg-white dark:bg-slate-900'
                                            : 'text-slate-400 dark:text-slate-500 border-transparent hover:text-slate-600 dark:hover:text-slate-300'
                                        }`}
                                >
                                    {t.icon} {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-6 flex-none md:flex-1 overflow-visible md:overflow-y-auto custom-scrollbar space-y-5">

                        {activeTab === 'info' && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                            <FileText className="w-3.5 h-3.5" /> Tên Truyện
                                        </label>
                                        <input 
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                            value={localInfo.title}
                                            onChange={e => setLocalInfo({...localInfo, title: e.target.value})}
                                            placeholder="Nhập tên truyện..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                            <User className="w-3.5 h-3.5" /> Tác Giả
                                        </label>
                                        <input 
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                            value={localInfo.author}
                                            onChange={e => setLocalInfo({...localInfo, author: e.target.value})}
                                            placeholder="Tên tác giả..."
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                            <User className="w-3.5 h-3.5" /> Dịch Giả (Tùy chọn)
                                        </label>
                                        <input 
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                            value={localInfo.translator || ''}
                                            onChange={e => setLocalInfo({...localInfo, translator: e.target.value})}
                                            placeholder="Tên dịch giả / nhóm dịch..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                            <Book className="w-3.5 h-3.5" /> NXB / Nhóm Dịch (Tùy chọn)
                                        </label>
                                        <input 
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                            value={localInfo.publisher || ''}
                                            onChange={e => setLocalInfo({...localInfo, publisher: e.target.value})}
                                            placeholder="Tên nhóm dịch / NXB..."
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" /> Giới Thiệu / Tóm Tắt (Summary)
                                    </label>
                                    <textarea 
                                        className="w-full h-32 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-300 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all resize-none custom-scrollbar"
                                        value={localInfo.summary || ''}
                                        onChange={e => setLocalInfo({...localInfo, summary: e.target.value})}
                                        placeholder="Nội dung giới thiệu truyện sẽ hiển thị ở trang đầu của Ebook..."
                                    />
                                </div>

                                <div className="bg-sky-50 dark:bg-sky-900/20 p-4 rounded-xl border border-sky-100 dark:border-sky-800/50">
                                    <h4 className="text-xs font-bold text-sky-700 dark:text-sky-400 uppercase mb-2">Trợ Lý Local sẽ tự động:</h4>
                                    <ul className="text-xs text-sky-800 dark:text-sky-300 space-y-1 list-disc pl-4">
                                        <li>Lọc sạch ký tự rác (*, #, =, ---).</li>
                                        <li>Đưa tiêu đề về đầu dòng để tạo Mục Lục (TOC) chuẩn.</li>
                                        <li>Thụt đầu dòng đoạn văn và giãn dòng đôi.</li>
                                        <li>Đóng gói <b>{totalFiles}</b> chương thành 1 file EPUB duy nhất.</li>
                                    </ul>
                                </div>
                            </>
                        )}

                        {activeTab === 'font' && (
                            <>
                                <FilePicker
                                    label="Font Tiêu Đề (Chương X, Tên Sách)"
                                    accept=".ttf,.otf,.woff,.woff2"
                                    file={assets.titleFont}
                                    onChange={f => setAssets({...assets, titleFont: f})}
                                    hint="Dùng cho tiêu đề chương và tên sách ở trang tựa. Hợp font họa tiết/thư pháp (blackletter, script...) để tạo điểm nhấn."
                                />
                                <FilePicker
                                    label="Font Nội Dung (Văn bản chính)"
                                    accept=".ttf,.otf,.woff,.woff2"
                                    file={assets.contentFont || localFont}
                                    onChange={f => { setAssets({...assets, contentFont: f}); setLocalFont(null); }}
                                    hint="Dùng cho toàn bộ đoạn văn trong truyện. Nên chọn font serif dễ đọc (Georgia, Times, Merriweather...)."
                                />
                                <div className="bg-sky-50 dark:bg-sky-900/20 p-4 rounded-xl border border-sky-100 dark:border-sky-800/50">
                                    <p className="text-xs text-sky-800 dark:text-sky-300">
                                        Không chọn font nào thì EPUB dùng font mặc định (Georgia cho nội dung, Palatino cho tiêu đề) — tương thích tốt với mọi máy đọc.
                                        Font tùy chỉnh được nhúng thẳng vào file EPUB nên hiện đúng trên mọi thiết bị, kể cả khi máy đọc không cài font đó.
                                    </p>
                                </div>
                            </>
                        )}

                        {activeTab === 'design' && (
                            <>
                                <FilePicker
                                    label="Ảnh Banner Đầu Chương (Tùy chọn)"
                                    accept="image/*"
                                    file={assets.chapterIcon}
                                    onChange={f => setAssets({...assets, chapterIcon: f})}
                                    hint="Ảnh trang trí lặp lại ở đầu MỌI chương, ngay trên/cạnh dòng 'Chương X' — giống banner phù hiệu trong ảnh mẫu."
                                />
                                {assets.chapterIcon && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Vị Trí Ảnh</label>
                                            <select
                                                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200"
                                                value={design.chapterIconPosition}
                                                onChange={e => setDesign({...design, chapterIconPosition: e.target.value as EpubDesignOptions['chapterIconPosition']})}
                                            >
                                                <option value="top">Phía trên chữ</option>
                                                <option value="inline">Cạnh chữ (ngang hàng)</option>
                                                <option value="bottom">Phía dưới chữ</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Chiều Cao Ảnh ({design.iconHeight}em)</label>
                                            <input
                                                type="range" min={1} max={10} step={0.5}
                                                value={design.iconHeight}
                                                onChange={e => setDesign({...design, iconHeight: Number(e.target.value)})}
                                                className="w-full accent-rose-500"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="h-px bg-slate-100 dark:bg-slate-800" />

                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Chữ Cái Đầu Chương To (Drop Cap)</label>
                                        <p className="text-[11px] text-slate-400">Chữ cái đầu tiên của mỗi chương phóng to nhiều dòng, kiểu sách in cổ điển.</p>
                                    </div>
                                    <button
                                        onClick={() => setDesign({...design, enableDropCaps: !design.enableDropCaps})}
                                        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${design.enableDropCaps ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${design.enableDropCaps ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                </div>
                                {design.enableDropCaps && (
                                    <div className="space-y-2 pl-1">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Cao Bao Nhiêu Dòng ({design.dropCapLines})</label>
                                        <input
                                            type="range" min={2} max={5} step={1}
                                            value={design.dropCapLines}
                                            onChange={e => setDesign({...design, dropCapLines: Number(e.target.value)})}
                                            className="w-full accent-rose-500"
                                        />
                                    </div>
                                )}

                                <div className="h-px bg-slate-100 dark:bg-slate-800" />

                                <FilePicker
                                    label="Ảnh Ngăn Cảnh (Tùy chọn)"
                                    accept="image/*"
                                    file={assets.dividerIcon}
                                    onChange={f => setAssets({...assets, dividerIcon: f})}
                                    hint="Thay cho dòng '***' giữa truyện. Nếu không chọn ảnh, dùng hoa văn chữ bên dưới."
                                />
                                {!assets.dividerIcon && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Hoa Văn Chữ Ngăn Cảnh</label>
                                        <input
                                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center text-lg text-slate-700 dark:text-slate-200"
                                            value={design.dividerOrnament}
                                            onChange={e => setDesign({...design, dividerOrnament: e.target.value})}
                                            maxLength={5}
                                        />
                                    </div>
                                )}

                                <div className="h-px bg-slate-100 dark:bg-slate-800" />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Căn Tiêu Đề Chương</label>
                                        <select
                                            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200"
                                            value={design.chapterTextAlign}
                                            onChange={e => setDesign({...design, chapterTextAlign: e.target.value as EpubDesignOptions['chapterTextAlign']})}
                                        >
                                            <option value="center">Giữa</option>
                                            <option value="left">Trái</option>
                                            <option value="right">Phải</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Giãn Dòng ({design.lineHeight})</label>
                                        <input
                                            type="range" min={1.2} max={2.2} step={0.1}
                                            value={design.lineHeight}
                                            onChange={e => setDesign({...design, lineHeight: Number(e.target.value)})}
                                            className="w-full accent-rose-500"
                                        />
                                    </div>
                                </div>

                                <div className="h-px bg-slate-100 dark:bg-slate-800" />

                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Trang Bìa Full-Bleed</label>
                                        <p className="text-[11px] text-slate-400">Trang đầu tiên của sách là ảnh bìa tràn viền, thay vì chỉ hiện icon ở thư viện.</p>
                                    </div>
                                    <button
                                        onClick={() => setDesign({...design, enableCoverPage: !design.enableCoverPage})}
                                        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${design.enableCoverPage ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${design.enableCoverPage ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Trang Tựa Sách</label>
                                        <p className="text-[11px] text-slate-400">Trang riêng ghi Tên Sách / Tác Giả / Dịch Giả / NXB, ngay sau trang bìa.</p>
                                    </div>
                                    <button
                                        onClick={() => setDesign({...design, enableTitlePage: !design.enableTitlePage})}
                                        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${design.enableTitlePage ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${design.enableTitlePage ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                </div>
                                {design.enableTitlePage && (
                                    <div className="space-y-2 pl-1">
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Kiểu Trang Tựa</label>
                                        <select
                                            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200"
                                            value={design.titlePageStyle}
                                            onChange={e => setDesign({...design, titlePageStyle: e.target.value as EpubDesignOptions['titlePageStyle']})}
                                        >
                                            <option value="classic">Cổ điển (căn giữa, có gạch ngăn)</option>
                                            <option value="modern">Hiện đại (căn trái, viền nhấn)</option>
                                            <option value="minimal">Tối giản</option>
                                        </select>
                                    </div>
                                )}

                                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-100 dark:border-amber-800/50">
                                    <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                                        <ImageIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                        Các dòng chỉ chứa ký tự trang trí (***, ☆★☆, •••...) giữa truyện sẽ tự động được nhận diện và đổi thành hoa văn/ảnh ngăn cảnh — không cần chỉnh sửa văn bản gốc.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0">
                        <button onClick={onClose} disabled={isConfirming} className="px-6 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-sm disabled:opacity-40">
                            Hủy Bỏ
                        </button>
                        <button 
                            onClick={() => void handleConfirm()}
                            disabled={isConfirming}
                            className="px-8 py-3 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white rounded-xl font-bold shadow-lg shadow-rose-200/50 dark:shadow-none transition-all flex items-center gap-2 text-sm disabled:opacity-50"
                        >
                            {isConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Book className="w-4 h-4" />} {isConfirming ? 'Đang tạo EPUB…' : 'Xuất Bản Ngay'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
