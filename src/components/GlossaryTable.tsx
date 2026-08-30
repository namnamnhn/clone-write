import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    RefreshCw, Search, ArrowDownAZ,
    Trash2, Plus, AlertTriangle, CheckSquare, Square, Copy
} from 'lucide-react';
import { parseGlossary, serializeGlossary, GlossaryEntry } from '../utils/text/glossaryFormat';

export type { GlossaryEntry };

export const GlossaryTable = ({ content, onChange, setConfirmModal }: { content: string, onChange: (v: string) => void, setConfirmModal: any }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [isTesting, setIsTesting] = useState(false);
    const [conflicts, setConflicts] = useState<Record<string, string>>({});
    
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const ROWS_PER_PAGE = 20;

    const [rows, setRows] = useState<GlossaryEntry[]>(() => parseGlossary(content));
    const lastSerializedRef = useRef(serializeGlossary(rows));

    useEffect(() => {
        if (content === lastSerializedRef.current) return;
        const next = parseGlossary(content);
        setRows(next);
        lastSerializedRef.current = content;
        setSelectedIds(prev => {
            const valid = new Set([...prev].filter(id => next.some(r => r.id === id)));
            return valid.size === prev.size ? prev : valid;
        });
        setConflicts(prev => {
            const ids = new Set(next.map(r => r.id));
            const pruned: Record<string, string> = {};
            Object.keys(prev).forEach(k => { if (ids.has(k)) pruned[k] = prev[k]; });
            return Object.keys(pruned).length === Object.keys(prev).length ? prev : pruned;
        });
    }, [content]);

    const handleUpdate = (updatedList: GlossaryEntry[]) => {
        setRows(updatedList);
        const str = serializeGlossary(updatedList);
        lastSerializedRef.current = str;
        onChange(str);
    };

    const handleEdit = (id: string, field: 'key' | 'value', text: string) => {
        const newEntries = rows.map(e => e.id === id ? { ...e, [field]: text } : e);
        handleUpdate(newEntries);
    };

    const handleAdd = () => {
        const newEntry = { id: crypto.randomUUID(), key: '', value: '', isComment: false };
        handleUpdate([newEntry, ...rows]);
    };

    const handleDelete = (id: string) => {
        handleUpdate(rows.filter(e => e.id !== id));
        const newSelected = new Set(selectedIds);
        newSelected.delete(id);
        setSelectedIds(newSelected);
    };

    const handleSort = () => {
        const sorted = [...rows].sort((a, b) => {
            if (a.isComment && !b.isComment) return -1;
            if (!a.isComment && b.isComment) return 1;
            return a.key.localeCompare(b.key);
        });
        handleUpdate(sorted);
    };

    const handleDeduplicate = () => {
        const seen = new Set();
        const unique = rows.filter(e => {
            if (e.isComment) return true;
            const k = e.key.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        handleUpdate(unique);
    };

    const handleTestConflict = () => {
        setIsTesting(true);
        setTimeout(() => {
            const keys = rows.filter(e => !e.isComment && e.key.trim()).map(e => e.key.trim());
            const newConflicts: Record<string, string> = {};
            rows.forEach(entry => {
                if (entry.isComment || !entry.key) return;
                const superKey = keys.find(k => k !== entry.key && k.includes(entry.key));
                if (superKey) {
                    newConflicts[entry.id] = `Xung đột: Là tập con của "${superKey}"`;
                }
            });
            setConflicts(newConflicts);
            setIsTesting(false);
        }, 100);
    };

    const displayRows = useMemo(() => rows.map(r => {
        const conflict = conflicts[r.id];
        return conflict ? { ...r, conflict } : r;
    }), [rows, conflicts]);

    const filtered = useMemo(() => {
        if (!searchTerm) return displayRows;
        const low = searchTerm.toLowerCase();
        return displayRows.filter(e => e.key.toLowerCase().includes(low) || e.value.toLowerCase().includes(low));
    }, [displayRows, searchTerm]);

    const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
    const currentPage = Math.min(page, Math.max(0, totalPages - 1));
    const paginated = filtered.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

    // Selection Logic
    const handleSelectRow = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const newSelected = new Set(selectedIds);
        
        if (e.shiftKey && lastSelectedId) {
            const visibleIds = paginated.map(r => r.id);
            const startIdx = visibleIds.indexOf(lastSelectedId);
            const endIdx = visibleIds.indexOf(id);
            
            if (startIdx !== -1 && endIdx !== -1) {
                const min = Math.min(startIdx, endIdx);
                const max = Math.max(startIdx, endIdx);
                for (let i = min; i <= max; i++) {
                    newSelected.add(visibleIds[i]);
                }
            } else {
                if (newSelected.has(id)) newSelected.delete(id);
                else newSelected.add(id);
            }
        } else {
            if (newSelected.has(id)) newSelected.delete(id);
            else newSelected.add(id);
        }
        
        setSelectedIds(newSelected);
        setLastSelectedId(id);
    };

    const handleSelectAll = () => {
        if (selectedIds.size === paginated.length && paginated.length > 0) {
            const newSelected = new Set(selectedIds);
            paginated.forEach(r => newSelected.delete(r.id));
            setSelectedIds(newSelected);
        } else {
            const newSelected = new Set(selectedIds);
            paginated.forEach(r => newSelected.add(r.id));
            setSelectedIds(newSelected);
        }
    };

    const handleDeleteSelected = () => {
        if (selectedIds.size === 0) return;
        handleUpdate(rows.filter(e => !selectedIds.has(e.id)));
        setSelectedIds(new Set());
    };

    const handleDeleteAll = () => {
        setConfirmModal({
            isOpen: true,
            title: "Xóa toàn bộ từ điển",
            message: "Bạn có chắc chắn muốn xóa TOÀN BỘ từ điển không? Hành động này không thể hoàn tác.",
            isDanger: true,
            confirmText: "Xóa tất cả",
            onConfirm: () => {
                handleUpdate([]);
                setSelectedIds(new Set());
            }
        });
    };

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    };

    const handleCopySelected = async () => {
        if (selectedIds.size > 0) {
            const selectedEntries = rows.filter(r => selectedIds.has(r.id));
            const textToCopy = selectedEntries.map(e => e.isComment ? e.key : `[${e.key}] = ${e.value}`).join('\n');
            await copyText(textToCopy);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                const newSelected = new Set(filtered.map(r => r.id));
                setSelectedIds(newSelected);
            } else if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                handleCopySelected();
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedIds.size > 0) {
                e.preventDefault();
                handleDeleteSelected();
            }
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        if (pastedText) {
            const newContent = content + (content.endsWith('\n') || !content ? '' : '\n') + pastedText;
            onChange(newContent);
        }
    };

    return (
        <div 
            className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 outline-none"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            ref={containerRef}
        >
            {/* Toolbar */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex gap-2 items-center bg-slate-50 dark:bg-slate-900/50 flex-wrap">
                <div className="relative flex-1 min-w-[150px]">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input 
                        className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                        placeholder="Tìm kiếm..."
                        value={searchTerm}
                        onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
                    />
                </div>
                <button onClick={handleAdd} className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200" title="Thêm từ"><Plus className="w-4 h-4" /></button>
                <button onClick={handleSort} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300" title="Sắp xếp A-Z"><ArrowDownAZ className="w-4 h-4" /></button>
                <button onClick={handleDeduplicate} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300" title="Lọc trùng"><RefreshCw className="w-4 h-4" /></button>
                <button onClick={handleTestConflict} className={`p-2 rounded-lg hover:bg-amber-200 transition-colors ${isTesting ? 'bg-amber-200 text-amber-700' : 'bg-amber-100 text-amber-600'}`} title="Kiểm tra xung đột (Test)"><AlertTriangle className="w-4 h-4" /></button>
                
                <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1"></div>
                
                {selectedIds.size > 0 ? (
                    <>
                        <button onClick={handleCopySelected} className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200" title="Copy dòng đã chọn"><Copy className="w-4 h-4" /></button>
                        <button onClick={handleDeleteSelected} className="p-2 bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200" title="Xóa dòng đã chọn"><Trash2 className="w-4 h-4" /></button>
                    </>
                ) : (
                    <button onClick={handleDeleteAll} className="p-2 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100" title="Xóa tất cả"><Trash2 className="w-4 h-4" /></button>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                        <tr>
                            <th className="px-3 py-2 rounded-l-lg w-10 text-center cursor-pointer" onClick={handleSelectAll}>
                                {paginated.length > 0 && selectedIds.size >= paginated.length ? <CheckSquare className="w-4 h-4 mx-auto text-emerald-500" /> : <Square className="w-4 h-4 mx-auto" />}
                            </th>
                            <th className="px-3 py-2 w-1/3">Từ Gốc (Key)</th>
                            <th className="px-3 py-2 w-1/3">Nghĩa (Value)</th>
                            <th className="px-3 py-2 rounded-r-lg w-10 text-center">Xóa</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginated.map(row => (
                            <tr key={row.id} onClick={(e) => handleSelectRow(e, row.id)} className={`border-b border-slate-50 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${selectedIds.has(row.id) ? 'bg-emerald-50/50 dark:bg-emerald-900/20' : ''}`}>
                                <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                    <button onClick={(e) => handleSelectRow(e, row.id)} className="text-slate-400 hover:text-emerald-500">
                                        {selectedIds.has(row.id) ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                                    </button>
                                </td>
                                {row.isComment ? (
                                    <td colSpan={2} className="px-2 py-1">
                                        <input 
                                            className="w-full bg-transparent text-slate-400 italic outline-none py-1" 
                                            value={row.key} 
                                            onChange={e => handleEdit(row.id, 'key', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </td>
                                ) : (
                                    <>
                                        <td className="px-2 py-1 relative">
                                            <input 
                                                className={`w-full bg-transparent font-bold outline-none py-1 focus:bg-white dark:focus:bg-slate-900 rounded px-1 ${row.conflict ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`}
                                                value={row.key}
                                                onChange={e => handleEdit(row.id, 'key', e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="Key"
                                            />
                                            {row.conflict && (
                                                <span className="absolute right-2 top-2 text-rose-500" title={row.conflict}><AlertTriangle className="w-3 h-3" /></span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1">
                                            <input 
                                                className="w-full bg-transparent text-slate-700 dark:text-slate-300 outline-none py-1 focus:bg-white dark:focus:bg-slate-900 rounded px-1"
                                                value={row.value}
                                                onChange={e => handleEdit(row.id, 'value', e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="Value"
                                            />
                                        </td>
                                    </>
                                )}
                                <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                    <button onClick={() => handleDelete(row.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition-opacity">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {paginated.length === 0 && (
                            <tr><td colSpan={4} className="text-center py-8 text-slate-400 italic">Không tìm thấy dữ liệu</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="p-2 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-xs text-slate-500">
                    <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-200">Trước</button>
                    <span>Trang {currentPage + 1} / {totalPages}</span>
                    <button disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)} className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-200">Sau</button>
                </div>
            )}
        </div>
    );
};
