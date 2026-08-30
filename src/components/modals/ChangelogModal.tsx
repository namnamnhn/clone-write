import React from 'react';
import { X, History, Info, GitCommit, FileText, Split, Sparkles, Eraser, Eye, Layout, Hammer, LifeBuoy, Microscope, Feather, Bot, Terminal, Book, ListFilter, RefreshCw, ShieldCheck, Wrench, Save, Key, Zap, Scale, Layers, Clock, Activity } from 'lucide-react';
import { CHANGELOG_DATA } from '../../changelog';

const IconMap: Record<string, React.ElementType> = {
    GitCommit, FileText, Split, Sparkles, Eraser, Eye, Layout, Hammer, LifeBuoy, Microscope, Feather, Bot, Terminal: Terminal, Moon: Book, ListFilter, RefreshCw, ShieldCheck, Wrench, Save, Key, Zap, BookA: Book, Scale, HardDrive: Layers, Clock, Activity, Book
};

export interface ChangelogModalProps { isOpen: boolean; onClose: () => void; }
export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><History className="w-5 h-5" /></div>
                        <div><h3 className="font-display font-bold text-lg text-slate-800">Nhật Ký Thay Đổi</h3></div>
                    </div>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
                    {CHANGELOG_DATA.map((entry, idx) => (
                        <div key={idx} className="mb-6 last:mb-0">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-bold">v{entry.version}</span>
                                <h4 className="font-bold text-slate-800">{entry.title}</h4>
                            </div>
                            <ul className="space-y-3 ml-1">
                                {entry.changes.map((c, i) => {
                                    const Icon = IconMap[c.icon] || Info;
                                    return (
                                        <li key={i} className="text-sm text-slate-600 flex gap-3">
                                            <div className="p-1.5 bg-slate-50 rounded-lg shrink-0 h-fit"><Icon className="w-3.5 h-3.5 text-indigo-500" /></div>
                                            <div className="pt-0.5"><b>{c.bold}</b> {c.text}</div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
