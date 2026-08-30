/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { ExternalLink, CheckCircle, AlertTriangle, Loader2, Upload, RefreshCw, X, ShieldCheck, CheckSquare, Square, Eye, EyeOff } from 'lucide-react';
import { deepSeekKeyManager, DeepSeekKeyStatus, DEEPSEEK_MODELS } from '../../../services/api/deepseek';

interface DeepSeekSettingsTabProps {
    active: boolean;
    localDsKey: string;
    setLocalDsKey: (v: string) => void;
    localDsModels: string[];
    setLocalDsModels: (v: string[]) => void;
    deepseekKey: string;
    setDeepseekKey: (v: string) => void;
}

export const DeepSeekSettingsTab: React.FC<DeepSeekSettingsTabProps> = ({
    active, localDsKey, setLocalDsKey, localDsModels, setLocalDsModels,
    deepseekKey, setDeepseekKey
}) => {
    const [dsKeyStatuses, setDsKeyStatuses] = useState<DeepSeekKeyStatus[]>([]);
    const [activeDsKeyInfo, setActiveDsKeyInfo] = useState<DeepSeekKeyStatus | null>(null);
    const [newDsKeyInput, setNewDsKeyInput] = useState("");
    const [dsKeyVisible, setDsKeyVisible] = useState(false); // fix65: mặc định CHE key đang nhập
    const [dsTesting, setDsTesting] = useState(false);
    const [dsTestResult, setDsTestResult] = useState<{ status: 'success' | 'error' | null, message: string }>({ status: null, message: '' });
    const [dsTestResults, setDsTestResults] = useState<{ modelId: string; modelName: string; status: 'success' | 'error' | 'testing'; message?: string }[]>([]);
    const dsAbortControllerRef = React.useRef<AbortController | null>(null);

    const getDsModelName = (id: string) => {
        const found = DEEPSEEK_MODELS.find(m => m.id === id);
        return found ? found.label : id;
    };

    const updateDsStatuses = React.useCallback(() => {
        setDsKeyStatuses(deepSeekKeyManager.getKeyStatuses());
        setActiveDsKeyInfo(deepSeekKeyManager.getCurrentKeyInfo());
    }, []);

    useEffect(() => {
        setDsTestResult({ status: null, message: '' });

        deepSeekKeyManager.syncKeys(deepseekKey);
        updateDsStatuses();

        const unsubscribe = deepSeekKeyManager.subscribe(() => {
            updateDsStatuses();
        });
        return () => unsubscribe();
    }, [deepseekKey, updateDsStatuses]);

    const handleAddDsKey = () => {
        if (!newDsKeyInput.trim()) return;
        const keysToAdd = newDsKeyInput.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        if (keysToAdd.length > 0) {
            const currentKeys = localDsKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
            const updatedKeys = [...currentKeys, ...keysToAdd];
            const newStr = updatedKeys.join('\n');
            setLocalDsKey(newStr);
            setNewDsKeyInput("");
            setDsTestResult({ status: 'success', message: `Đã thêm ${keysToAdd.length} key.` });
            deepSeekKeyManager.syncKeys(newStr);
            setDeepseekKey(newStr);
        }
    };

    const handleRemoveDsKey = (index: number) => {
        const currentKeys = localDsKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        currentKeys.splice(index, 1);
        const newStr = currentKeys.join('\n');
        setLocalDsKey(newStr);
        deepSeekKeyManager.syncKeys(newStr);
        setDeepseekKey(newStr);
    };

    const handleClearAllDs = () => {
        setLocalDsKey('');
        setDsTestResult({ status: null, message: '' });
        deepSeekKeyManager.syncKeys('');
        setDeepseekKey('');
    };

    const handleTestDs = async () => {
        if (!localDsKey) {
            setDsTestResult({ status: 'error', message: 'Vui lòng nhập API Key' });
            return;
        }
        const keys = localDsKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        if (keys.length === 0) {
            setDsTestResult({ status: 'error', message: 'Không tìm thấy API Key hợp lệ' });
            return;
        }
        if (localDsModels.length === 0) {
            setDsTestResult({ status: 'error', message: 'Vui lòng chọn ít nhất 1 model để test' });
            return;
        }

        setDsTesting(true);
        setDsTestResult({ status: null, message: '' });

        const initialResults = localDsModels.map(id => ({ modelId: id, modelName: getDsModelName(id), status: 'testing' as const }));
        setDsTestResults(initialResults);

        const controller = new AbortController();
        dsAbortControllerRef.current = controller;
        const signal = controller.signal;

        let hasError = false;
        const currentKey = deepSeekKeyManager.getCurrentKey() || keys[0];

        for (let i = 0; i < localDsModels.length; i++) {
            if (signal.aborted) break;
            const modelId = localDsModels[i];
            try {
                const res = await fetch("https://api.deepseek.com/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${currentKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: [{ role: "user", content: "Say 'OK'" }],
                        max_tokens: 5
                    }),
                    signal
                });

                if (res.ok) {
                    setDsTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success', message: 'Kết nối thành công' } : r));
                } else {
                    const err = await res.json().catch(() => ({}));
                    setDsTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: err.error?.message || `Thất bại (HTTP ${res.status})` } : r));
                    hasError = true;
                }
            } catch (e: any) {
                if (e.name === 'AbortError') break;
                setDsTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: 'Thất bại (Lỗi mạng/Timeout)' } : r));
                hasError = true;
            }
        }

        if (!signal.aborted) {
            setDsTesting(false);
            setDsTestResult({ status: hasError ? 'error' : 'success', message: hasError ? 'Có model kết nối thất bại' : 'Tất cả model kết nối thành công!' });
        }
    };

    const handleStopTestDs = () => {
        if (dsAbortControllerRef.current) {
            dsAbortControllerRef.current.abort();
            dsAbortControllerRef.current = null;
        }
        setDsTesting(false);
        setDsTestResult({ status: 'error', message: 'Đã dừng test' });
        setDsTestResults(prev => prev.map(r => r.status === 'testing' ? { ...r, status: 'error', message: 'Đã dừng' } : r));
    };

    const handleResetQuotaDs = () => {
        deepSeekKeyManager.resetQuota();
        setDsTestResult({ status: 'success', message: 'Đã reset quota toàn bộ Key!' });
    };

    const toggleDsModel = (modelId: string) => {
        if (localDsModels.includes(modelId)) {
            setLocalDsModels(localDsModels.filter(m => m !== modelId));
        } else {
            setLocalDsModels([...localDsModels, modelId]);
        }
    };

    return (
        <div className={active ? 'p-6 overflow-y-auto no-scrollbar overscroll-contain flex-1 flex flex-col md:flex-row gap-6' : 'hidden'}>
            {/* LEFT COLUMN: DEEPSEEK KEY MANAGEMENT */}
            <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Danh sách API Key DeepSeek</h4>
                    <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 flex items-center gap-1">
                        Lấy API Key <ExternalLink className="w-3 h-3" />
                    </a>
                </div>

                <div className="flex items-start gap-2">
                    {/* fix65 (bảo mật hiển thị): khoá API key đang nhập bằng hiệu ứng mờ — dán/gõ
                        bình thường nhưng người ngồi cạnh/khi chia sẻ màn hình không đọc được key.
                        Nút con mắt tạm bật hiển thị khi cần đối chiếu. */}
                    <div className="relative flex-1">
                        <textarea
                            placeholder="Dán API Key DeepSeek (sk-..., hỗ trợ nhiều dòng)..."
                            className="flex-1 w-full p-3 py-2 min-h-[70px] rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y transition-[filter] duration-150"
                            style={{ filter: dsKeyVisible ? 'none' : 'blur(7px)' }}
                            value={newDsKeyInput}
                            onChange={e => setNewDsKeyInput(e.target.value)}
                            spellCheck="false"
                            autoComplete="off"
                        />
                        <button
                            type="button"
                            onClick={() => setDsKeyVisible(v => !v)}
                            aria-label={dsKeyVisible ? 'Ẩn API Key' : 'Hiện API Key'}
                            title={dsKeyVisible ? 'Ẩn API Key' : 'Hiện API Key'}
                            className="absolute right-2 top-2 p-1.5 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400 shadow-sm transition-colors duration-200 ease-smooth"
                        >
                            {dsKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <button onClick={handleAddDsKey} disabled={!newDsKeyInput.trim()} className="px-3 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold hover:bg-teal-100 dark:hover:bg-teal-900/50 disabled:opacity-40 transition-colors duration-200 ease-smooth whitespace-nowrap">
                            Thêm
                        </button>
                        <label className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5" /> File
                            <input
                                type="file"
                                accept=".txt"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = (event) => {
                                        const text = event.target?.result as string;
                                        if (text) setNewDsKeyInput(text);
                                    };
                                    reader.readAsText(file);
                                    e.target.value = '';
                                }}
                            />
                        </label>
                    </div>
                </div>

                {dsKeyStatuses.length > 0 && (
                    <div className="space-y-2">
                        {dsKeyStatuses.map((k, idx) => (
                            <div key={k.key} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${k.status === 'Active' ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' : k.status === 'Error' || k.status === 'Exhausted' ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-400 dark:text-slate-500 font-mono text-xs">#{idx + 1}</span>
                                    <span className="font-mono text-slate-700 dark:text-slate-300">{k.maskedKey}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-[10px] font-bold uppercase ${k.status === 'Active' ? 'text-teal-600 dark:text-teal-400' : k.status === 'Error' || k.status === 'Exhausted' ? 'text-rose-500' : 'text-slate-400'}`}>{k.status === 'Active' ? 'ACTIVE' : k.status}</span>
                                    <button onClick={() => handleRemoveDsKey(idx)} className="text-slate-300 hover:text-rose-500 transition-colors duration-200 ease-smooth" aria-label="Xoá key">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
                            <span>Tự động xoay vòng khi hết Quota</span>
                            <button onClick={handleClearAllDs} className="text-rose-500 hover:text-rose-600 font-medium">Bỏ tất cả</button>
                        </div>
                    </div>
                )}

                {activeDsKeyInfo && (
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 px-1">
                        <span>Số request thành công: <strong>{activeDsKeyInfo.successCount}</strong></span>
                        <button onClick={handleResetQuotaDs} className="text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 font-medium flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> Reset Quota toàn bộ
                        </button>
                    </div>
                )}
            </div>

            {/* RIGHT COLUMN: DEEPSEEK MODELS */}
            <div className="flex-1 flex flex-col gap-3 md:min-h-0">
                <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Model DeepSeek</h4>
                    <div className="flex items-center gap-2">
                        {dsTesting && (
                            <button
                                onClick={handleStopTestDs}
                                className="px-3 py-1.5 bg-danger-500 hover:bg-danger-600 text-white rounded-lg text-xs font-bold shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 ease-smooth flex items-center gap-1.5"
                            >
                                <Square className="w-3.5 h-3.5 fill-current" />
                                Dừng Test
                            </button>
                        )}
                        <button
                            onClick={handleTestDs}
                            disabled={dsTesting || localDsModels.length === 0 || dsKeyStatuses.length === 0}
                            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 ease-smooth disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {dsTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                            Test API
                        </button>
                    </div>
                </div>

                {dsTestResults.length > 0 && (
                    <div className={`p-3 rounded-lg border text-sm ${dsTestResult.status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : dsTestResult.status === 'error' ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                        <div className="font-bold mb-2 flex items-center gap-2">
                            {dsTestResult.status === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : dsTestResult.status === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-500" /> : <Loader2 className="w-4 h-4 text-teal-500 animate-spin" />}
                            Kết quả Test API
                        </div>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar overscroll-contain">
                            {dsTestResults.map((r, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                    {r.status === 'testing' ? (
                                        <Loader2 className="w-4 h-4 text-teal-500 animate-spin mt-0.5 flex-shrink-0" />
                                    ) : r.status === 'success' ? (
                                        <span className="text-emerald-500 mt-0.5 flex-shrink-0">✅</span>
                                    ) : (
                                        <span className="text-rose-500 mt-0.5 flex-shrink-0">❌</span>
                                    )}
                                    <div className="flex-1 text-xs leading-relaxed">
                                        <span className="font-bold text-slate-700 dark:text-slate-200">[{r.modelName}]: </span>
                                        <span className={r.status === 'error' ? 'text-rose-600 dark:text-rose-400 font-medium' : r.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
                                            {r.status === 'testing' ? 'Đang kiểm tra...' : r.message}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="md:flex-1 no-scrollbar md:overflow-y-auto md:overscroll-contain space-y-1">
                    {DEEPSEEK_MODELS.map(m => (
                        <div key={m.id} onClick={() => toggleDsModel(m.id)} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors duration-200 ease-smooth ${localDsModels.includes(m.id) ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                            <div className="text-teal-500">
                                {localDsModels.includes(m.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-300 dark:text-slate-600" />}
                            </div>
                            <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300">{m.label}</div>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Các model được tích chọn sẽ được xoay vòng ngẫu nhiên khi gọi API để tránh Rate Limit.
                </p>
            </div>
        </div>
    );
};
