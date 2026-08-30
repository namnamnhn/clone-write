
import React, { useState } from 'react';
import { StoryInfo, FileItem, TranslationTier, LogEntry, AutomationConfig, EpubDesignOptions, EpubDesignAssets } from '../types';
import { IS_LITE } from '../constants';
import { Zap, Activity, Sparkles, RefreshCw } from 'lucide-react';
import { hasApiKey } from '../utils/apiKeys';

const PasteModal = React.lazy(() => import('./modals/PasteModal').then(m => ({ default: m.PasteModal })));
const FindReplaceModal = React.lazy(() => import('./modals/FindReplaceModal').then(m => ({ default: m.FindReplaceModal })));
const ConfirmationModal = React.lazy(() => import('./modals/ConfirmationModal').then(m => ({ default: m.ConfirmationModal })));
const ImportModal = React.lazy(() => import('./modals/ImportModal').then(m => ({ default: m.ImportModal })));
const GuideModal = React.lazy(() => import('./modals/GuideModal').then(m => ({ default: m.GuideModal })));
const StartOptionsModal = React.lazy(() => import('./modals/StartOptionsModal').then(m => ({ default: m.StartOptionsModal })));
const NameAnalysisModal = React.lazy(() => import('./modals/NameAnalysisModal').then(m => ({ default: m.NameAnalysisModal })));
const SmartStartModal = React.lazy(() => import('./modals/SmartStartModal').then(m => ({ default: m.SmartStartModal })));
const ChangelogModal = React.lazy(() => import('./modals/ChangelogModal').then(m => ({ default: m.ChangelogModal })));
const LogModal = React.lazy(() => import('./modals/LogModal').then(m => ({ default: m.LogModal })));
const SplitterModal = React.lazy(() => import('./SplitterModal').then(m => ({ default: m.SplitterModal })));
const EditorModal = React.lazy(() => import('./EditorModal').then(m => ({ default: m.EditorModal })));
const PromptDesignerModal = React.lazy(() => import('./PromptDesignerModal').then(m => ({ default: m.PromptDesignerModal })));
const ZipActionModal = React.lazy(() => import('./ZipActionModal').then(m => ({ default: m.ZipActionModal })));
const EpubPreviewModal = React.lazy(() => import('./EpubPreviewModal').then(m => ({ default: m.EpubPreviewModal })));
const AutomationModal = React.lazy(() => import('./AutomationModal').then(m => ({ default: m.AutomationModal })));

interface ModalManagerProps {
    // ... (Existing props)
    // Modal States
    showPasteModal: boolean;
    setShowPasteModal: (v: boolean) => void;
    showFindReplace: boolean;
    setShowFindReplace: (v: boolean) => void;
    confirmModal: any;
    setConfirmModal: (v: any) => void;
    importModal: any;
    setImportModal: (v: any) => void;
    splitterModal: any;
    setSplitterModal: (v: any) => void;
    zipActionModal: boolean;
    setZipActionModal: (v: boolean, sourceType?: 'zip' | 'epub') => void;
    zipActionModalSourceType?: 'zip' | 'epub';
    handleZipKeepSeparate: () => void;
    handleZipMergeAndSplit: () => void;
    showGuide: boolean;
    setShowGuide: (v: boolean) => void;
    showStartOptions: boolean;
    setShowStartOptions: (v: boolean) => void;
    showNameAnalysisModal: boolean;
    setShowNameAnalysisModal: (v: boolean) => void;
    showSmartStartModal: boolean;
    setShowSmartStartModal: (v: boolean) => void;
    showChangelog: boolean;
    setShowChangelog: (v: boolean) => void;
    editingFileId: string | null;
    setEditingFileId: (v: string | null) => void;
    showRetranslateModal: boolean;
    setShowRetranslateModal: (v: boolean) => void;
    
    // EPUB Preview
    showEpubModal: boolean;
    setShowEpubModal: (v: boolean) => void;
    handleEpubConfirm: (info: StoryInfo, cover: File | null, font: File | null, designOptions?: EpubDesignOptions, designAssets?: EpubDesignAssets) => void;
    handleRegenerateCover?: (info: StoryInfo) => Promise<File | null>;
    
    // Logs
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    systemLogs: LogEntry[];
    clearLogs: () => void;

    // Prompt Designer
    showPromptDesigner: boolean;
    setShowPromptDesigner: (v: boolean) => void;
    handlePromptDesignerConfirm: (config: any) => void;
    handleRefineAdditionalRules: () => void;
    isOptimizingPrompt: boolean;
    selectedTemplateKey: string;
    setSelectedTemplateKey: (v: string) => void;

    // AUTOMATION (NEW)
    showAutomationModal: boolean;
    setShowAutomationModal: (v: boolean) => void;
    handleAutomationStart: (config: AutomationConfig) => void;
    handleAutomationStop: () => void; // New Prop
    resumeAutomationWithCooldown: () => void;
    automationState: { isRunning: boolean, currentStep: number, countdown: number, totalSteps: number, stepStatus: string };
    automationInitialConfig: { steps: number[], rules: string, tier: TranslationTier, engine?: 'gemini' | 'deepseek' }; // New prop

    // Handlers & Data
    handlePasteConfirm: (title: string, content: string) => void;
    handleFindReplace: (pairs: {find: string, replace: string}[], scope: 'all' | 'selected') => void;
    selectedCount: number;
    handleImportAppend: () => void;
    handleImportOverwrite: () => void;
    handleSplitConfirm: (files: FileItem[]) => void;
    handleConfirmStart: (tier: TranslationTier, translationModels: string[]) => void;
    isSmartAutoMode: boolean;
    handleNameAnalysis: (config: any) => void;
    isAnalyzingNames: boolean;
    nameAnalysisProgress: any;
    storyInfo: StoryInfo;
    totalFiles: number;
    handleSmartStartRun: (useSearch: boolean, additionalRules: string, sampling: { start: number, middle: number, end: number }) => void;
    handleSkipSmartStart: () => void;
    setStoryInfo: (v: any) => void;
    autoOptimizePrompt: boolean;
    setAutoOptimizePrompt: (v: boolean) => void;
    smartStartStep: any;
    coverImage: File | null;
    setCoverImage: (v: File | null) => void;
    files: FileItem[];
    saveEditor: (id: string, content: string) => void;
    autoSaveEditor: (id: string, content: string) => void;
    dictionary: string;
    promptTemplate: string;
    addToast: (msg: string, type: any) => void;
    setAdditionalDictionary: (v: any) => void;
    handleRetranslateConfirm: (keepOld: boolean, tier: TranslationTier) => void;
    handleFindReplaceInFile: (fileId: string, find: string, replace: string) => void;
    // DeepSeek credentials – cần cho AutomationModal (Engine = DeepSeek)
    deepseekKey: string;
    deepseekModel: string;
    setDeepseekKey: (v: string) => void;
    setDeepseekModel: (v: string) => void;
}

export const ModalManager: React.FC<ModalManagerProps> = (props) => {
    
    const [retranslateKeepOld, setRetranslateKeepOld] = useState(true);

    const onAddToGlossary = (raw: string, edit: string) => {
        const entry = `${raw}=${edit}`;
        props.setAdditionalDictionary((prev: string) => (prev ? prev + '\n' + entry : entry));
        props.addToast(`Đã thêm: ${entry}`, 'success');
    };

    const handleReplaceAllInEditor = (find: string, replace: string) => {
        if(props.editingFileId) {
            props.handleFindReplaceInFile(props.editingFileId, find, replace);
        }
    };

    const handleSaveAndNext = (id: string, content: string) => {
        props.autoSaveEditor(id, content);
        const currentIndex = props.files.findIndex(f => f.id === id);
        if (currentIndex >= 0 && currentIndex < props.files.length - 1) {
            const nextFile = props.files[currentIndex + 1];
            props.setEditingFileId(nextFile.id);
            props.addToast(`Đã lưu và chuyển sang: ${nextFile.name}`, 'success');
        } else {
            props.saveEditor(id, content);
            props.addToast('Đã lưu file cuối cùng', 'success');
        }
    };

    const handleSaveAndPrev = (id: string, content: string) => {
        props.autoSaveEditor(id, content);
        const currentIndex = props.files.findIndex(f => f.id === id);
        if (currentIndex > 0) {
            const prevFile = props.files[currentIndex - 1];
            props.setEditingFileId(prevFile.id);
            props.addToast(`Đã lưu và chuyển sang: ${prevFile.name}`, 'success');
        } else {
            props.saveEditor(id, content);
            props.addToast('Đã lưu file đầu tiên', 'success');
        }
    };

    const handleNext = (id: string) => {
        const currentIndex = props.files.findIndex(f => f.id === id);
        if (currentIndex >= 0 && currentIndex < props.files.length - 1) {
            const nextFile = props.files[currentIndex + 1];
            props.setEditingFileId(nextFile.id);
        }
    };

    const handlePrev = (id: string) => {
        const currentIndex = props.files.findIndex(f => f.id === id);
        if (currentIndex > 0) {
            const prevFile = props.files[currentIndex - 1];
            props.setEditingFileId(prevFile.id);
        }
    };

    const editingFile = props.files.find(f => f.id === props.editingFileId);
    const currentIndex = props.files.findIndex(f => f.id === props.editingFileId);
    const hasNext = currentIndex >= 0 && currentIndex < props.files.length - 1;
    const hasPrev = currentIndex > 0;

    return (
        <React.Suspense fallback={null}>
            {props.showPasteModal && <PasteModal isOpen onClose={() => props.setShowPasteModal(false)} onConfirm={props.handlePasteConfirm} />}
            {props.showFindReplace && <FindReplaceModal isOpen onClose={() => props.setShowFindReplace(false)} onReplace={props.handleFindReplace} selectedCount={props.selectedCount} />}
            {props.confirmModal.isOpen && <ConfirmationModal {...props.confirmModal} onCancel={() => props.setConfirmModal({ ...props.confirmModal, isOpen: false })} />}
            {props.importModal.isOpen && <ImportModal isOpen count={props.importModal.pendingFiles.length} onAppend={props.handleImportAppend} onOverwrite={props.handleImportOverwrite} onCancel={() => props.setImportModal({ isOpen: false, pendingFiles: [] })} />}
            {props.zipActionModal && <ZipActionModal isOpen sourceType={props.zipActionModalSourceType} onClose={() => props.setZipActionModal(false)} onKeepSeparate={props.handleZipKeepSeparate} onMergeAndSplit={props.handleZipMergeAndSplit} />}
            {props.splitterModal.isOpen && <SplitterModal isOpen fileContent={props.splitterModal.content} fileName={props.splitterModal.name} isTranslatedImport={props.splitterModal.isTranslatedImport} onConfirmSplit={props.handleSplitConfirm} onCancel={() => props.setSplitterModal({ isOpen: false, content: '', name: '' })} />}
            {props.showGuide && <GuideModal isOpen onClose={() => props.setShowGuide(false)} />}
            {props.showStartOptions && <StartOptionsModal isOpen onClose={() => { props.setShowStartOptions(false); }} onConfirm={props.handleConfirmStart} isSmartMode={props.isSmartAutoMode} hasDeepSeekKey={hasApiKey(props.deepseekKey)} />}
            {props.showNameAnalysisModal && <NameAnalysisModal 
                key={props.showNameAnalysisModal ? 'name-analysis-open' : 'name-analysis-closed'} 
                isOpen={props.showNameAnalysisModal} 
                onClose={() => {
                    props.setShowNameAnalysisModal(false);
                    if (props.automationState.isRunning && props.automationState.currentStep === 2) {
                        props.resumeAutomationWithCooldown();
                    }
                }} 
                onConfirm={props.handleNameAnalysis} 
                isAnalyzing={props.isAnalyzingNames} 
                progress={props.nameAnalysisProgress} 
                storyInfo={props.storyInfo} 
                totalFiles={props.totalFiles} 
            />}
            {props.showSmartStartModal && <SmartStartModal isOpen onClose={() => props.setShowSmartStartModal(false)} onConfirm={props.handleSmartStartRun} onSkip={props.handleSkipSmartStart} storyInfo={props.storyInfo} setStoryInfo={props.setStoryInfo} autoOptimize={props.autoOptimizePrompt} setAutoOptimize={props.setAutoOptimizePrompt} step={props.smartStartStep} />}
            {props.showChangelog && <ChangelogModal isOpen onClose={() => props.setShowChangelog(false)} />}
            {props.showLogs && <LogModal isOpen onClose={() => props.setShowLogs(false)} logs={props.systemLogs} clearLogs={props.clearLogs} />}
            {props.showEpubModal && <EpubPreviewModal isOpen onClose={() => props.setShowEpubModal(false)} onConfirm={props.handleEpubConfirm} onRegenerateCover={props.handleRegenerateCover} storyInfo={props.storyInfo} coverImage={props.coverImage} totalFiles={props.files.length} />}
            {props.showPromptDesigner && <PromptDesignerModal 
                key={props.showPromptDesigner ? 'prompt-designer-open' : 'prompt-designer-closed'} 
                isOpen={props.showPromptDesigner} 
                onClose={() => {
                    props.setShowPromptDesigner(false);
                    if (props.automationState.isRunning && props.automationState.currentStep === 3) {
                        props.resumeAutomationWithCooldown();
                    }
                }} 
                onConfirm={props.handlePromptDesignerConfirm} 
                storyInfo={props.storyInfo} 
                setStoryInfo={props.setStoryInfo} 
                isOptimizing={props.isOptimizingPrompt} 
                handleRefineAdditionalRules={props.handleRefineAdditionalRules}
            />}
            
            {/* NEW AUTOMATION MODAL */}
            {props.showAutomationModal && <AutomationModal 
                key={props.showAutomationModal ? 'automation-open' : 'automation-closed'}
                isOpen={props.showAutomationModal} 
                onClose={() => props.setShowAutomationModal(false)} 
                onStart={props.handleAutomationStart}
                onStop={props.handleAutomationStop}
                isRunning={props.automationState.isRunning}
                currentStep={props.automationState.currentStep}
                countdown={props.automationState.countdown}
                totalSteps={props.automationState.totalSteps}
                stepStatus={props.automationState.stepStatus}
                initialConfig={props.automationInitialConfig}
                deepseekKey={props.deepseekKey}
                deepseekModel={props.deepseekModel}
                setDeepseekKey={props.setDeepseekKey}
                setDeepseekModel={props.setDeepseekModel}
            />}

            {props.showRetranslateModal && ( 
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"> 
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"> 
                        <div className="p-6"> 
                            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-indigo-500" /> Dịch lại {props.selectedCount} chương</h3> 
                            <label className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer mb-4 hover:bg-slate-100 transition-colors">
                                <input type="checkbox" checked={retranslateKeepOld} onChange={e => setRetranslateKeepOld(e.target.checked)} className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500" />
                                <div className="text-xs">
                                    <span className="font-bold text-slate-700 block">Giữ nội dung cũ?</span>
                                    <span className="text-slate-500">Giữ bản dịch cũ để tham khảo trong Editor (Split View) trong khi chờ bản mới.</span>
                                </div>
                            </label>
                            <p className="text-xs text-slate-500 mb-2 font-bold uppercase tracking-wider">Chọn cấp độ dịch:</p>
                            <div className="space-y-2">
                                <button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'lite'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 bg-yellow-50 border border-yellow-100 hover:bg-yellow-100 text-yellow-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-3">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Zap className="w-4 h-4" /></div> Lite Mode (3.1 Flash Lite)
                                </button>
                                <button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'deepseek'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 rounded-xl text-xs font-bold transition-colors flex items-center gap-3 border bg-teal-50 border-teal-100 hover:bg-teal-100 text-teal-700">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Zap className="w-4 h-4" /></div> DeepSeek (API Model)
                                </button>
                                <button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'flash'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 bg-sky-50 border border-sky-100 hover:bg-sky-100 text-sky-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-3">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Zap className="w-4 h-4" /></div> Flash Mode (Nhanh)
                                </button>
                                {!IS_LITE && (<button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'normal'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-3 ring-1 ring-indigo-200">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Activity className="w-4 h-4" /></div> Normal Mode (Khuyên dùng)
                                </button>)}
                                {!IS_LITE && (<button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'pro'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 bg-purple-50 border border-purple-100 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-3">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Sparkles className="w-4 h-4" /></div> Pro Mode (Chất lượng cao)
                                </button>)}
                                {!IS_LITE && (<button onClick={() => { props.handleRetranslateConfirm(retranslateKeepOld, 'full'); props.setShowRetranslateModal(false); }} className="w-full py-2 px-3 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-3">
                                    <div className="p-1 bg-white rounded-lg shadow-sm"><Activity className="w-4 h-4" /></div> Full Mode (Pro + Flash)
                                </button>)}
                            </div>
                            <button onClick={() => props.setShowRetranslateModal(false)} className="w-full mt-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600"> Hủy bỏ </button> 
                        </div> 
                    </div> 
                </div> 
            )}

            {props.editingFileId && editingFile && (
                <EditorModal file={editingFile} onClose={() => props.setEditingFileId(null)} onSave={props.saveEditor} onSaveAndNext={handleSaveAndNext} onSaveAndPrev={handleSaveAndPrev} onNext={handleNext} onPrev={handlePrev} hasNext={hasNext} hasPrev={hasPrev} onAutoSave={props.autoSaveEditor} storyInfoContext={props.storyInfo.contextNotes || ""} dictionary={props.dictionary} promptTemplate={props.promptTemplate} onAddToGlossary={onAddToGlossary} onReplaceAll={handleReplaceAllInEditor} addToast={props.addToast} />
            )}
        </React.Suspense>
    );
};
