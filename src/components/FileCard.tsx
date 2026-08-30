
import React, { memo } from 'react';
import { 
    CheckCircle, AlertCircle, Hammer, Loader2, Clock, Split,
    FileText, Check, Bug, AlignLeft, RefreshCw, Edit3, X, LifeBuoy, AlertTriangle, ScanSearch
} from 'lucide-react';
import { FileItem, FileStatus, StoryInfo, RatioLimits } from '../types';
import { validateTranslationIntegrity } from '../utils/text';

interface FileCardProps {
    file: FileItem;
    isSelected: boolean;
    storyInfo: StoryInfo;
    ratioLimits?: RatioLimits; // Added optional prop
    handleSelectFile: (id: string, shiftKey: boolean) => void;
    handleManualFixSingle: (e: React.MouseEvent, id: string) => void;
    requestRetranslateSingle: (e: React.MouseEvent, id: string) => void;
    handleAutoSplitChapters: (scope: 'all' | 'selected' | 'single', id?: string, threshold?: number, numParts?: number) => void;
    openEditor: (file: FileItem) => void;
    handleRemoveFile: (id: string) => void;
    handleRescueCopy: (e: React.MouseEvent, file: FileItem) => void;
}

const FileCard: React.FC<FileCardProps> = ({ 
    file, isSelected, storyInfo, ratioLimits,
    handleSelectFile, handleManualFixSingle, requestRetranslateSingle, handleAutoSplitChapters, openEditor, handleRemoveFile, handleRescueCopy 
}) => {
    const formatNumber = (num: number) => new Intl.NumberFormat('vi-VN').format(num);
    const isRepairing = file.status === FileStatus.REPAIRING;
    const isProcessing = file.status === FileStatus.PROCESSING;
    
    // Strict Integrity Check using centralized logic
    const integrity = validateTranslationIntegrity(file.content, file.translatedContent || "", ratioLimits, storyInfo.languages, file.usedModel);
    const isRatioSuspicious = !integrity.isValid && integrity.reason?.toLowerCase().includes('tỷ lệ');
    const isRatioLow = file.status === FileStatus.ERROR && integrity.ratio < 0.2; // Extra check for critical failure
    
    const ratioPercent = Math.round(integrity.ratio * 100);

    // Has Content to Show?
    const hasContent = file.translatedContent && file.translatedContent.length > 0;

    // Helper for button visibility (Processing states usually lock actions)
    const isLocked = isProcessing || isRepairing;

    // Helper for Status Background Colors (Pastel)
    const getStatusColor = () => {
        if (isSelected) return 'bg-indigo-50/80 dark:bg-indigo-900/40 border-indigo-500 ring-1 ring-indigo-500';
        switch (file.status) {
            case FileStatus.COMPLETED:
                if (file.remainingRawCharCount > 0) return 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50 hover:border-orange-300';
                if (isRatioSuspicious) return 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 hover:border-rose-300';
                return 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30 hover:border-emerald-300';
            case FileStatus.ERROR:
                return 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 hover:border-rose-300';
            case FileStatus.PROCESSING:
            case FileStatus.REPAIRING:
                // FIX (bug "nháy nháy" card đang Streaming, lần 2): animate-pulse áp lên TOÀN BỘ
                // thẻ làm opacity cả card (tiêu đề, số liệu, badge, nút bấm...) mờ↔rõ lặp liên tục
                // suốt quá trình dịch, nhiều thẻ dịch song song lệch pha nhau -> cả lưới lập loè.
                // SỬA: bỏ animate-pulse khỏi thẻ, chuyển xuống đúng Ô ICON nhỏ (xem dưới) — vẫn
                // đủ tín hiệu "đang chạy" khi lướt mắt nhưng không còn làm mờ nội dung thẻ.
                return 'bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/50 hover:border-sky-300';
            default:
                return 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700';
        }
    };

    return (
        <div onClick={(e) => { if(!(e.target as HTMLElement).closest('button')) handleSelectFile(file.id, e.shiftKey) }} 
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); handleSelectFile(file.id, e.shiftKey); } }}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`Tệp ${file.name}${isSelected ? ' (đã chọn)' : ''}`}
            // FIX (bug nhấp nháy card đang Streaming): trước đây dùng `transition-all`, tức CSS
            // transition áp dụng luôn cho cả `opacity` — mà `opacity` cũng chính là thuộc tính mà
            // `animate-pulse` (Tailwind, bật khi status PROCESSING/REPAIRING) đang animate liên tục.
            // 2 cơ chế cùng tranh giành 1 thuộc tính trên cùng phần tử: mỗi lần file đang dịch nhận
            // cập nhật nội dung streaming (onUpdate flush mỗi 500ms trong useTranslator.ts) khiến
            // React re-render card, transition 200ms lại chen ngang animation pulse 2s đang chạy dở
            // -> giật/nhấp nháy thấy rõ, đặc biệt rõ từ khi có cập nhật nội dung streaming trực tiếp.
            // SỬA: giới hạn transition chỉ áp cho transform/box-shadow/border-color/background-color
            // (những hiệu ứng hover/chọn thật sự cần transition mượt) — bỏ hẳn opacity ra khỏi phạm
            // vi transition để animate-pulse chạy độc lập, không bị ngắt quãng mỗi lần re-render.
            className={`group relative rounded-xl p-3 pb-10 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-smooth cursor-pointer shadow-elevation-1 hover:shadow-elevation-2 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${getStatusColor()}`}
        >
            <div className="flex flex-col gap-1.5">
                {/* Header */}
                <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-elevation-1 transition-transform duration-200 ease-smooth group-hover:scale-105 
                        ${file.status === FileStatus.COMPLETED ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400' : 
                        file.status === FileStatus.ERROR ? 'bg-rose-100 text-rose-500 dark:bg-rose-900/50 dark:text-rose-400' : 
                        // FIX: điểm "đang chạy" thu nhỏ vào riêng ô icon (animate-pulse) thay vì cả thẻ
                        // (xem getStatusColor ở trên) — icon xoay (animate-spin) + đốm pulse nhỏ là đủ.
                        isRepairing ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400 animate-pulse' : 
                        isProcessing ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-400 animate-pulse' : 
                        'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                        {file.status === FileStatus.COMPLETED ? <CheckCircle className="w-4 h-4" /> : 
                            file.status === FileStatus.ERROR ? <AlertCircle className="w-4 h-4" /> : 
                            isRepairing ? <Hammer className="w-4 h-4 animate-bounce" /> :
                            isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 
                            <FileText className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0 pr-8"> 
                        <h3 className="font-display font-bold text-slate-800 dark:text-slate-100 text-sm truncate leading-tight mb-0.5" title={file.name}>{file.name}</h3>
                        <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            {file.processingDuration ? (
                                <span className="flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5 text-slate-300 dark:text-slate-500" /> {(file.processingDuration / 1000).toFixed(1)}s
                                </span>
                            ) : (
                                <span className="text-slate-400">{file.status === FileStatus.IDLE ? 'Chờ dịch' : '...'}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Status & Badges */}
                <div className="flex items-center gap-1 flex-wrap">
                    {/* Main Status Badge */}
                    {file.status === FileStatus.COMPLETED ? (
                        file.remainingRawCharCount === 0 ? (
                            isRatioSuspicious ? (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded border bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900/50 flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Lệch?
                                </span>
                            ) : (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50 flex items-center gap-0.5">
                                    <Check className="w-2.5 h-2.5" /> Sạch
                                </span>
                            )
                        ) : (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded border bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-900/50 flex items-center gap-0.5" title="Ký tự tiếng Trung gốc còn sót lại trong bản dịch">
                                <Bug className="w-2.5 h-2.5" /> Sót {file.remainingRawCharCount} Raw
                            </span>
                        )
                    ) : (
                        <span 
                            title={file.errorMessage}
                            className={`text-[9px] font-bold px-1 py-0.5 rounded border flex items-center gap-0.5
                            ${file.status === FileStatus.ERROR ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900/50 cursor-help' : 
                            file.status === FileStatus.IDLE && file.errorMessage ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/50 cursor-help' :
                            isProcessing ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border-sky-100 dark:border-sky-900/50' : 
                            'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-700'}`}>
                            {file.status === FileStatus.ERROR ? (
                                <><AlertCircle className="w-2.5 h-2.5" /> {(file.errorMessage?.includes('an toàn') || file.errorMessage?.includes('Safety')) ? 'Safety Filter' : file.errorMessage?.includes('tiêu đề') ? 'Mất Header' : file.errorMessage?.includes('thiếu nội dung') ? 'Thiếu ND' : file.errorMessage?.includes('bịa đặt nội dung') ? 'Thừa ND' : file.errorMessage?.includes('chưa dịch hết') ? 'Sót Raw' : file.errorMessage?.includes('nhầm kết quả') ? 'Trả Nhầm' : 'Lỗi'}</>
                            ) : file.status === FileStatus.IDLE && file.shortContentKind === 'non_story' ? (
                                <><ScanSearch className="w-2.5 h-2.5" /> Ngoài truyện</>
                            ) : file.status === FileStatus.IDLE && file.errorMessage ? (
                                // NEW (đề xuất cải thiện fix12): tệp chưa từng thử dịch vì hệ thống CHỦ ĐỘNG
                                // dừng (vd hết Quota Gemini toàn bộ) mang errorMessage riêng để phân biệt với
                                // tệp thật sự lỗi - hiện badge "Tạm dừng" màu hổ phách thay vì đỏ (Lỗi thật).
                                <><Clock className="w-2.5 h-2.5" /> Tạm dừng</>
                            ) : 
                             isProcessing && hasContent ? 'Streaming...' : file.status}
                        </span>
                    )}

                    {file.usedModel && (
                        <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 px-1 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded truncate max-w-[120px]" title={file.usedModel}>
                            {file.usedModel.startsWith('deepseek:') ? file.usedModel.replace('deepseek:', 'DS: ').replace('deepseek-', '').toUpperCase() :
                             file.usedModel.replace('gemini-', '').replace('-preview', '')}
                        </span>
                    )}

                    {file.ratioWarning && (
                        <span 
                            title={file.ratioWarning} 
                            className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-medium bg-yellow-50 text-yellow-600 border border-yellow-200 cursor-help"
                        >
                            ⚠️ Ratio
                        </span>
                    )}
                </div>

                {/* Metrics - Always Visible */}
                <div className={`flex justify-between items-center gap-1 text-[9px] font-mono p-0.5 rounded border px-1.5
                    ${isRatioLow || isRatioSuspicious ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-900/40' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
                    
                    <div className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400" title="Ký tự gốc">
                        <AlignLeft className="w-2.5 h-2.5" /> {formatNumber(file.originalCharCount)}
                    </div>
                    
                    {hasContent ? (
                        <>
                            <div className="flex justify-center">
                                    {/* FIX (yêu cầu người dùng): trước đây badge này luôn được tô màu (xanh dương mặc
                                    định, hổ phách nếu vượt mốc cứng 200%) ở MỌI thẻ kể cả tỷ lệ hoàn toàn bình
                                    thường, khiến người dùng khó rà mắt tìm đúng thẻ có vấn đề thật giữa hàng loạt
                                    thẻ cùng bị tô màu. Nay chỉ tô màu rose khi thực sự VƯỢT NGƯỠNG đã cấu hình
                                    (isRatioSuspicious/isRatioLow, tính theo ratioLimits theo từng ngôn ngữ ở
                                    validateTranslationIntegrity) — còn lại (fix83) dùng emerald để đồng bộ với
                                    badge "Sạch" và số ký tự dịch bên cạnh (cùng dùng emerald ở trạng thái bình
                                    thường), thay vì indigo (fix81, người dùng thấy emerald dễ nhìn hơn). */}
                                    <div className={`px-1 rounded text-[8px] font-bold flex items-center justify-center min-w-[24px]
                                    ${(isRatioSuspicious || isRatioLow) ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400' :
                                        'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`} title="Tỷ lệ dịch">
                                    {ratioPercent}%
                                </div>
                            </div>
                            
                            <div className="flex items-center justify-end font-bold text-slate-700 dark:text-slate-300" title="Ký tự dịch">
                                <span className={isRatioLow || isRatioSuspicious ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>{formatNumber(file.translatedContent!.length)}</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 text-right">
                             <span className="text-[8px] text-slate-300 dark:text-slate-600 italic">
                                Chờ dịch...
                            </span>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Delete Button (Keep Top Right - Always Visible) */}
            <button 
                onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.id); }} 
                className="absolute -top-1.5 -right-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:text-danger-500 rounded-full p-1.5 shadow-elevation-2 border border-slate-100 dark:border-slate-700 transition-all duration-200 ease-smooth z-10 opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                title="Xóa file"
            >
                <X className="w-3 h-3" />
            </button>

            {/* Actions Bar (Bottom Right - Always Visible) */}
            <div className="absolute bottom-2 right-2 flex gap-1 z-20">
                {/* Auto Split - Only if IDLE/FAILED and > 10000 chars */}
                {(file.status === FileStatus.IDLE || file.status === FileStatus.ERROR) && file.content && file.content.length > 10000 && (
                    <button onClick={(e) => { e.stopPropagation(); handleAutoSplitChapters('single', file.id); }} className="p-2 bg-white dark:bg-slate-800 text-teal-600 dark:text-teal-400 rounded-lg shadow-elevation-1 border border-slate-100 dark:border-slate-700 hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Tách chương lớn">
                        <Split className="w-3.5 h-3.5" />
                    </button>
                )}
                
                {/* Smart Fix - Only if Completed */}
                {file.status === FileStatus.COMPLETED && (
                    <button onClick={(e) => { e.stopPropagation(); handleManualFixSingle(e, file.id); }} className="p-2 bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 rounded-lg shadow-elevation-1 border border-slate-100 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Quick Fix">
                        <Hammer className="w-3.5 h-3.5" />
                    </button>
                )}
                
                {/* Editor - Always Available */}
                <button onClick={(e) => { e.stopPropagation(); openEditor(file); }} className="p-2 bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 rounded-lg shadow-elevation-1 border border-slate-100 dark:border-slate-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Xem/Sửa">
                    <Edit3 className="w-3.5 h-3.5" />
                </button>
                
                {/* Rescue - Always Available */}
                <button onClick={(e) => { e.stopPropagation(); handleRescueCopy(e, file); }} className="p-2 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 rounded-lg shadow-elevation-1 border border-slate-100 dark:border-slate-700 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Cứu hộ (Copy Prompt)">
                    <LifeBuoy className="w-3.5 h-3.5" />
                </button>

                {/* Retranslate / Start - Always Available (Unless locked) */}
                {!isLocked && (
                    <button onClick={(e) => { e.stopPropagation(); requestRetranslateSingle(e, file.id); }} className="p-2 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg shadow-elevation-1 border border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1" title="Dịch Lại">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
};

export default memo(FileCard);
