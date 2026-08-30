import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface TagInputProps { label: string; icon: React.ReactNode; options: string[]; selected: string[]; onChange: (selected: string[]) => void; placeholder?: string; }
export const TagInput: React.FC<TagInputProps> = ({ label, icon, options, selected = [], onChange, placeholder }) => { 
    const [inputValue, setInputValue] = useState(''); 
    const [showOptions, setShowOptions] = useState(false); 
    const containerRef = useRef<HTMLDivElement>(null); 
    const safeSelected = Array.isArray(selected) ? selected : [];
    const handleAdd = (val: string) => { 
        const values = val.split(/[,;]+/).map(v => v.trim()).filter(v => v);
        const newSelected = [...safeSelected];
        values.forEach(v => { if (v && !newSelected.includes(v)) newSelected.push(v); });
        if (newSelected.length !== safeSelected.length) onChange(newSelected);
        setInputValue(''); setShowOptions(false); 
    }; 
    const handleRemove = (val: string) => { onChange(safeSelected.filter(i => i !== val)); }; 
    const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(inputValue); } }; 
    useEffect(() => { const handleClickOutside = (event: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(event.target as Node)) setShowOptions(false); }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, []); 
    const filteredOptions = options.filter(opt => !safeSelected.includes(opt) && opt.toLowerCase().includes(inputValue.toLowerCase())); 
    return ( <div className="space-y-1.5 relative" ref={containerRef}> <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5"> {icon} {label} </label> <div className="min-h-[38px] px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus-within:ring-2 focus-within:ring-info-200 dark:focus-within:ring-info-800 focus-within:border-info-300 dark:focus-within:border-info-700 transition-all duration-200 ease-smooth flex flex-wrap gap-1.5 shadow-elevation-1"> {safeSelected.map(tag => ( <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md text-[10px] font-bold border border-slate-200 dark:border-slate-600"> {tag} <button onClick={() => handleRemove(tag)} className="hover:text-danger-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger-400 rounded-sm"><X className="w-3 h-3" /></button> </span> ))} <input type="text" className="flex-1 min-w-[60px] bg-transparent outline-none text-xs py-0.5 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500" placeholder={safeSelected.length === 0 ? placeholder : ""} value={inputValue} onChange={e => { setInputValue(e.target.value); setShowOptions(true); }} onFocus={() => setShowOptions(true)} onKeyDown={handleKeyDown} /> </div> {showOptions && (inputValue || filteredOptions.length > 0) && ( <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-elevation-4 max-h-48 overflow-y-auto custom-scrollbar p-1"> {filteredOptions.length > 0 ? ( filteredOptions.map(opt => ( <button key={opt} onClick={() => handleAdd(opt)} className="w-full text-left px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-info-50 dark:hover:bg-info-900/30 hover:text-info-700 dark:hover:text-info-400 rounded-lg transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" > {opt} </button> )) ) : ( inputValue && ( <button onClick={() => handleAdd(inputValue)} className="w-full text-left px-3 py-1.5 text-xs text-info-600 dark:text-info-400 hover:bg-info-50 dark:hover:bg-info-900/30 rounded-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"> Thêm mới "{inputValue}" </button> ) )} </div> )} </div> ); 
};
