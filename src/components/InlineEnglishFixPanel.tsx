import React, { useState, useMemo, useEffect } from 'react';
import { FileItem, LogContext } from '../types';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../services/api/gemini';
import { Loader2, Zap, RefreshCw, AlertTriangle, CheckCircle, Eye } from 'lucide-react';
import { applyInlineEnglishFix, detectUnmappedInlineEnglish, COMMON_EN_VI_MAP } from '../utils/text/inlineEnglishFixer';

interface Props {
    files: FileItem[];
    setFilesSafe: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info', context?: LogContext) => void;
    storyInfo?: any;
    promptTemplate?: string;
    dictionary?: string;
}

export const InlineEnglishFixPanel: React.FC<Props> = ({ files, setFilesSafe, addToast, addLog, storyInfo, promptTemplate, dictionary }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [isFixingAI, setIsFixingAI] = useState(false);
    const [isFixingRule, setIsFixingRule] = useState(false);
    const [scanResult, setScanResult] = useState<{
        totalFiles: number;
        affectedFiles: number;
        totalLines: number;
        samples: { file: string; line: string; words: string[] }[];
    } | null>(null);
    const [showSamples, setShowSamples] = useState(false);

    // Thống kê nhanh
    // FIX (hiệu năng): quickStats chạy applyInlineEnglishFix trên tối đa 20 chương đầy đủ —
    // trước đây phụ thuộc thẳng `files` nên mỗi tick streaming (~500ms/lần khi đang dịch mà
    // tab này mở) đều quét lại toàn bộ, gây giật lag. Giờ dùng bản chụp DEBOUNCE 4s: timer
    // reset mỗi lần files đổi, chỉ quét khi dữ liệu thực sự yên ổn (đang dịch thì tạm hoãn).
    const [statFiles, setStatFiles] = useState<FileItem[]>(files);
    useEffect(() => {
        const timer = setTimeout(() => setStatFiles(files), 4000);
        return () => clearTimeout(timer);
    }, [files]);

    const quickStats = useMemo(() => {
        let totalIssues = 0;
        let affectedFiles = 0;
        const translatedFiles = statFiles.filter(f => f.translatedContent);
        
        for (const f of translatedFiles.slice(0, 20)) { // Sample 20 files for speed
            const { changes } = applyInlineEnglishFix(f.translatedContent || '', {} as any) as any; // Using basic logic
            if (changes && changes.length > 0) {
                affectedFiles++;
                totalIssues += changes.length;
            }
        }
        return { totalIssues, affectedFiles, sampleSize: Math.min(20, translatedFiles.length) };
    }, [statFiles]);

    const handleScan = () => {
        setIsScanning(true);
        setScanResult(null);

        setTimeout(() => {
            const translatedFiles = files.filter(f => f.translatedContent);
            let totalLines = 0;
            let affectedFiles = 0;
            const samples: { file: string; line: string; words: string[] }[] = [];

            for (const f of translatedFiles) {
                const unmapped = detectUnmappedInlineEnglish(f.translatedContent || '', dictionary, storyInfo?.contextNotes, promptTemplate, storyInfo?.genres || []);
                const fixedContent = applyInlineEnglishFix(f.translatedContent || '');
                // Basic comparison to simulate 'changes' from applyInlineEnglishFix since the original function signature was slightly different in counting changes, we can just compare content
                const hasRuleChanges = fixedContent !== f.translatedContent;
                
                if (unmapped.length > 0 || hasRuleChanges) {
                    affectedFiles++;
                    totalLines += unmapped.length + (hasRuleChanges ? 1 : 0);
                    
                    unmapped.slice(0, 3).forEach(u => {
                        if (samples.length < 30) {
                            samples.push({ file: f.name, line: u.line.substring(0, 120), words: u.enWords });
                        }
                    });
                }
            }

            setScanResult({ totalFiles: translatedFiles.length, affectedFiles, totalLines, samples });
            setIsScanning(false);
        }, 100);
    };

    const handleRuleFix = () => {
        setIsFixingRule(true);
        
        setTimeout(() => {
            let totalFiles = 0;
            
            const newFiles = files.map(f => {
                if (!f.translatedContent) return f;
                const fixed = applyInlineEnglishFix(f.translatedContent);
                if (fixed !== f.translatedContent) {
                    totalFiles++;
                    return { ...f, translatedContent: fixed };
                }
                return f;
            });

            setFilesSafe(newFiles);
            const msg = `Đã tự động sửa các từ/cụm tiếng Anh inline trong ${totalFiles} file!`;
            addToast(msg, 'success');
            addLog?.(msg, 'success');
            setScanResult(null);
            setIsFixingRule(false);
        }, 50);
    };

    const handleAIFix = async () => {
        const translatedFiles = files.filter(f => f.translatedContent);
        if (translatedFiles.length === 0) {
            addToast('Không có file đã dịch để xử lý.', 'error');
            return;
        }

        setIsFixingAI(true);
        addLog?.('Bắt đầu AI Fix tiếng Anh inline...', 'info');

        try {
            const ai = getAiClient();
            
            const problemLines: { fileId: string; lineIndex: number; line: string; enWords: string[] }[] = [];
            
            for (const f of translatedFiles) {
                const unmapped = detectUnmappedInlineEnglish(f.translatedContent || '', dictionary, storyInfo?.contextNotes, promptTemplate, storyInfo?.genres || []);
                unmapped.forEach(u => {
                    problemLines.push({ fileId: f.id, lineIndex: u.lineIndex, line: u.line, enWords: u.enWords });
                });
            }

            if (problemLines.length === 0) {
                addToast('Không tìm thấy từ tiếng Anh inline không có rule. Hãy dùng "Sửa tự động (Rule)"!', 'info');
                setIsFixingAI(false);
                return;
            }

            addLog?.(`Tìm thấy ${problemLines.length} dòng cần AI xử lý.`, 'info');

            const BATCH_SIZE = 100;
            const batches: typeof problemLines[] = [];
            for (let i = 0; i < problemLines.length; i += BATCH_SIZE) batches.push(problemLines.slice(i, i + BATCH_SIZE));

            const fixMap = new Map<string, Map<number, string>>();

            for (let b = 0; b < batches.length; b += 2) {
                const batchPair = batches.slice(b, b + 2);
                
                const promises = batchPair.map(async (batch) => {
                    const inputLines = batch.map((item, idx) => `[LINE_${idx}] ${item.line}`).join('\n');
                    const prompt = `Bạn là biên tập viên truyện tiếng Việt. Các câu dưới đây là câu tiếng Việt nhưng bị lẫn từ tiếng Anh.
Nhiệm vụ: Dịch các từ/cụm tiếng Anh trong câu thành tiếng Việt tự nhiên.

QUY TẮC QUAN TRỌNG:
- Chỉ dịch các từ tiếng Anh thông thường (liên từ, giới từ, động từ thông thường...).
- KHÔNG dịch tên riêng nhân vật, địa danh, tên công pháp, tên kỹ năng (bắt đầu bằng chữ hoa).
- Giữ nguyên cấu trúc câu tiếng Việt, chỉ thay từ tiếng Anh thành từ tiếng Việt tương đương.
- Trả về đúng format: [LINE_N] câu đã sửa. Mỗi dòng một kết quả.

Thể loại truyện: ${storyInfo?.genres?.join(', ') || 'Chưa xác định'}

Danh sách câu cần sửa:
${inputLines}

CHỈ TRẢ VỀ CÁC DÒNG ĐÃ SỬA, KHÔNG GIẢI THÍCH.`;

                    const result = await smartExecution(
                        ['gemini-3.5-flash', 'gemini-3-flash-preview'],
                        async (modelId) => {
                            const r = await ai.models.generateContent({
                                model: modelId, contents: prompt,
                                config: { safetySettings: SAFETY_SETTINGS, temperature: 0.1, maxOutputTokens: 8192 }
                            });
                            return r.text || '';
                        },
                        `AI Fix tiếng Anh inline batch ${b + 1}`,
                        (msg, context) => addLog?.(msg, 'info', context)
                    );

                    result.split('\n').forEach(line => {
                        const m = line.match(/^\[LINE_(\d+)\]\s*(.*)/);
                        if (m) {
                            const idx = parseInt(m[1]);
                            const fixedLine = m[2].trim();
                            if (idx >= 0 && idx < batch.length && fixedLine) {
                                const item = batch[idx];
                                if (!fixMap.has(item.fileId)) fixMap.set(item.fileId, new Map());
                                fixMap.get(item.fileId)!.set(item.lineIndex, fixedLine);
                            }
                        }
                    });
                });

                await Promise.all(promises);
                if (b + 2 < batches.length) await new Promise(r => setTimeout(r, 600));
            }

            let totalFixed = 0;
            let totalFilesFixed = 0;

            const newFiles = files.map(f => {
                if (!f.translatedContent) return f;
                
                const lineMap = fixMap.get(f.id);
                let content = applyInlineEnglishFix(f.translatedContent);
                
                if (lineMap && lineMap.size > 0) {
                    const lines = content.split('\n');
                    lineMap.forEach((fixedLine, lineIdx) => {
                        if (lineIdx < lines.length) {
                            lines[lineIdx] = fixedLine;
                            totalFixed++;
                        }
                    });
                    content = lines.join('\n');
                    totalFilesFixed++;
                }
                
                return { ...f, translatedContent: content };
            });

            setFilesSafe(newFiles);
            const msg = `AI đã sửa ${totalFixed} dòng trong ${totalFilesFixed} file + rule-based fix toàn bộ!`;
            addToast(msg, 'success');
            addLog?.(msg, 'success');
            setScanResult(null);

        } catch (e: any) {
            addToast(`Lỗi AI fix: ${e.message}`, 'error');
        } finally {
            setIsFixingAI(false);
        }
    };

    const isWorking = isScanning || isFixingAI || isFixingRule;
    const translatedCount = files.filter(f => f.translatedContent).length;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-sm overflow-hidden mt-6">
            <div className="px-5 py-4 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/30">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
                            <Zap className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-amber-900 dark:text-amber-300 text-sm">Lọc Tiếng Anh Inline</h3>
                            <p className="text-xs text-amber-700 dark:text-amber-500">Phát hiện và sửa từ tiếng Anh bị AI chen vào câu văn tiếng Việt</p>
                        </div>
                    </div>
                    <div className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                        {translatedCount} file đã dịch
                    </div>
                </div>
            </div>

            <div className="p-5 space-y-4">
                {translatedCount > 0 && quickStats.totalIssues > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-3 flex items-center gap-3">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Ước tính <strong>{quickStats.totalIssues}</strong> lần thay thế có thể áp dụng
                            {quickStats.sampleSize < files.filter(f => f.translatedContent).length && ` (dựa trên ${quickStats.sampleSize} file mẫu)`}
                        </p>
                    </div>
                )}

                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    <p>✅ <strong>Rule-based (nhanh)</strong>: Thay thế ngay các từ có trong bản đồ cố định ({Object.keys(COMMON_EN_VI_MAP).length} từ/cụm).</p>
                    <p>🤖 <strong>AI Fix (toàn diện)</strong>: Gom các câu chưa có rule, gửi AI dịch theo batch song song.</p>
                </div>

                {scanResult && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                <CheckCircle className="w-4 h-4 text-teal-500" />
                                Kết quả quét: {scanResult.affectedFiles}/{scanResult.totalFiles} file bị ảnh hưởng
                            </div>
                            {scanResult.samples.length > 0 && (
                                <button onClick={() => setShowSamples(v => !v)} className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-700">
                                    <Eye className="w-3.5 h-3.5" /> {showSamples ? 'Ẩn' : 'Xem'} mẫu
                                </button>
                            )}
                        </div>
                        {showSamples && scanResult.samples.length > 0 && (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {scanResult.samples.slice(0, 15).map((s, i) => (
                                    <div key={i} className="text-xs bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700">
                                        <span className="text-slate-400 font-mono">[{s.file}]</span>{' '}
                                        <span className="text-amber-600 dark:text-amber-400">{s.words.join(', ')}</span>{' '}
                                        <span className="text-slate-600 dark:text-slate-300">→ {s.line}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleScan}
                        disabled={isWorking || translatedCount === 0}
                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors"
                    >
                        {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                        Quét & Xem mẫu
                    </button>

                    <button
                        onClick={handleRuleFix}
                        disabled={isWorking || translatedCount === 0}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
                    >
                        {isFixingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        Sửa tự động (Rule)
                    </button>

                    <button
                        onClick={handleAIFix}
                        disabled={isWorking || translatedCount === 0}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
                    >
                        {isFixingAI ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI đang xử lý...</> : <><RefreshCw className="w-3.5 h-3.5" /> AI Fix toàn diện</>}
                    </button>
                </div>
            </div>
        </div>
    );
};
