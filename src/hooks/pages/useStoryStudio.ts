import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createGeminiProductionStoryRuntime } from '../../services/storyEngine';
import { buildStoryStudioViewModel } from '../../storyStudio/storyStudioPresenter';
import { EMPTY_STORY_STUDIO_SESSION, STORY_STUDIO_DEMO_VIEW_MODEL } from '../../storyStudio/storyStudioDemoViewModel';
import { StoryStudioProjectController } from '../../storyStudio/production/storyStudioProjectController';
import type {
    StoryStudioProjectId,
    StoryStudioProjectLibraryViewEntry,
    StoryStudioProjectRecoveryTarget,
    StoryStudioRuntimeProject,
} from '../../storyStudio/production/storyStudioProjectTypes';
import { buildConnectedStoryStudioSession } from '../../storyStudio/production/storyStudioSession';
import {
    prepareAuthorTextStorySetupImport,
    prepareJsonStorySetupImport,
    logSafeStorySetupImportDiagnostic,
    StorySetupImportError,
} from '../../storyStudio/production/storySetupImport';
import type { PreparedStorySetupImport } from '../../storyStudio/production/storySetupImport';
import type { StoryStudioBatchSize } from '../../storyStudio/production/storyStudioWorkflowTypes';
import { logSafeStoryStudioRuntimeDiagnostic } from '../../storyStudio/production/storyStudioRuntimeDiagnostics';
import {
    STORY_SETUP_BLANK_TEMPLATE_MARKDOWN,
    StorySetupWizardDraftRepository,
    completeDurableWizardCreate,
    createEmptyStorySetupWizardDraft,
    downloadStorySetupMarkdown,
    renderExistingProjectSetupMarkdown,
    renderStorySetupWizardMarkdown,
    validateStorySetupWizardDraft,
} from '../../storyStudio/setup/storySetupWizard';
import type { StorySetupWizardDraftV1 } from '../../storyStudio/setup/storySetupWizard';

export type StoryStudioSaveStatus = 'saved' | 'saving' | 'error';
export type StoryStudioLoadStatus = 'loading' | 'empty' | 'connected' | 'core-corrupt';
export type StoryStudioOperation =
    | 'compiling-setup' | 'planning' | 'writing' | 'validation' | 'extraction' | 'canon-review' | 'stopping';

export interface UseStoryStudioProps {
    readonly enabledModels: readonly string[];
    readonly addToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readonly onOpenGeminiSettings: () => void;
}

export type StoryStudioExplicitAttempt = 'startBatch' | 'resume' | 'rewriteFromSamePlan' | 'replan';
export type StoryStudioPreparedImportOrigin = 'normal' | 'verified-core-corrupt-library';
export type StoryStudioPageView = 'loading' | 'wizard' | 'setup-review' | 'core-corrupt' | 'no-active' | 'studio';

export interface StoryStudioRecoveryUiState {
    readonly recoveryTarget?: StoryStudioProjectRecoveryTarget;
    readonly errorMessage?: string;
}

export type StoryStudioRecoveryUiAction =
    | { readonly type: 'core-corrupt'; readonly recoveryTarget?: StoryStudioProjectRecoveryTarget; readonly errorMessage: string }
    | { readonly type: 'connected' }
    | { readonly type: 'clear-error' }
    | { readonly type: 'operation-error'; readonly errorMessage: string };

/** Keeps corrupt-load deletion authority coupled to the UI state that granted it. */
export const reduceStoryStudioRecoveryUiState = (
    state: StoryStudioRecoveryUiState,
    action: StoryStudioRecoveryUiAction,
): StoryStudioRecoveryUiState => {
    if (action.type === 'connected') return {};
    if (action.type === 'clear-error') return { ...state, errorMessage: undefined };
    if (action.type === 'operation-error') return { ...state, errorMessage: action.errorMessage };
    return { recoveryTarget: action.recoveryTarget, errorMessage: action.errorMessage };
};

export const getStoryStudioRecoveryDeleteTarget = (
    loadStatus: StoryStudioLoadStatus,
    recoveryTarget?: StoryStudioProjectRecoveryTarget,
): StoryStudioProjectRecoveryTarget | undefined => loadStatus === 'core-corrupt' ? recoveryTarget : undefined;

export const getStoryStudioNoActiveProjectViewState = (
    entries: readonly unknown[],
): { readonly showProjectLibrary: boolean; readonly showImportCreation: true } => ({
    showProjectLibrary: entries.length > 0,
    showImportCreation: true,
});

export const getStoryStudioPreparedImportOrigin = (
    loadStatus: StoryStudioLoadStatus,
    hasValidProjectLibrary: boolean,
): StoryStudioPreparedImportOrigin | undefined => {
    if (loadStatus !== 'core-corrupt') return 'normal';
    return hasValidProjectLibrary ? 'verified-core-corrupt-library' : undefined;
};

/** Explicit precedence prevents setup review from bypassing an untrusted corrupt storage state. */
export const getStoryStudioPageView = (input: {
    readonly loadStatus: StoryStudioLoadStatus;
    readonly hasValidProjectLibrary: boolean;
    readonly hasPreparedImport: boolean;
    readonly preparedImportOrigin?: StoryStudioPreparedImportOrigin;
    readonly hasOpenWizard?: boolean;
    readonly wizardOrigin?: StoryStudioPreparedImportOrigin;
    readonly hasProject: boolean;
    readonly showDemo: boolean;
}): StoryStudioPageView => {
    if (input.loadStatus === 'loading') return 'loading';
    const reviewAllowed = input.hasPreparedImport && (
        input.loadStatus !== 'core-corrupt'
        || (input.hasValidProjectLibrary && input.preparedImportOrigin === 'verified-core-corrupt-library')
    );
    if (reviewAllowed) return 'setup-review';
    const wizardAllowed = input.hasOpenWizard && (
        input.loadStatus !== 'core-corrupt'
        || (input.hasValidProjectLibrary && input.wizardOrigin === 'verified-core-corrupt-library')
    );
    if (wizardAllowed) return 'wizard';
    if (input.loadStatus === 'core-corrupt') return 'core-corrupt';
    if (!input.hasProject && !input.showDemo) return 'no-active';
    return 'studio';
};

export const runStoryStudioProductionAttempt = async <T>(
    attempt: StoryStudioExplicitAttempt,
    clearError: (value: undefined) => void,
    run: (attempt: StoryStudioExplicitAttempt) => Promise<T>,
): Promise<T> => {
    clearError(undefined);
    return run(attempt);
};

export const getStoryStudioSafeMessage = (error: unknown): string => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const messages: Readonly<Record<string, string>> = {
        NO_MODEL_AVAILABLE: 'Không có model Gemini văn bản đang bật. Hãy mở Cài đặt Gemini và bật một model phù hợp.',
        INVALID_PROJECT: 'Dự án V4 không hợp lệ hoặc không khớp Canon hiện tại.',
        CORE_IDENTITY_MISMATCH: 'Dữ liệu Canon cục bộ không vượt qua kiểm tra toàn vẹn.',
        MEMORY_STORY_MISMATCH: 'Bộ nhớ truyện không thuộc dự án này.',
        MEMORY_CANON_MISMATCH: 'Bộ nhớ truyện không khớp đầu Canon hiện tại.',
        STALE_STAGE_ARTIFACT: 'Phiên chương đang làm đã cũ so với Canon. Hãy lập kế hoạch lại.',
        PLAN_PROTOCOL_FAILURE: 'Planner trả về dữ liệu không đúng giao thức.',
        PLAN_VALIDATION_FAILURE: 'Kế hoạch không vượt qua kiểm tra an toàn.',
        NO_ALLOWED_POV: 'Chương hiện tại không có nhân vật POV hợp lệ. Canon và dự án vẫn được giữ nguyên.',
        WRITER_PROTOCOL_FAILURE: 'Writer không tạo được bản nháp hợp lệ.',
        VALIDATOR_INFRASTRUCTURE_FAILURE: 'Validator gặp lỗi hạ tầng. Canon chưa thay đổi.',
        MODEL_RUNTIME_FAILURE: 'Gemini gặp lỗi khi xử lý. Canon chưa thay đổi.',
        VALIDATION_REJECTED: 'Bản nháp không được Validator chấp thuận.',
        EXTRACTION_BLOCKED: 'Không thể tạo đề xuất Canon an toàn từ chương này.',
        CANON_REVIEW_BLOCKED: 'Đề xuất Canon không vượt qua kiểm tra review.',
        CANCELLED: 'Đã dừng an toàn. Canon và bộ nhớ không thay đổi.',
        SAVE_FAILED: 'Không thể lưu dự án vào trình duyệt. Trạng thái bền vững trước đó vẫn được giữ nguyên.',
        LOAD_FAILED: 'Không thể đọc dự án V4 đã lưu trên trình duyệt này.',
        INVALID_LIBRARY: 'Thư viện dự án Story Studio không vượt qua kiểm tra toàn vẹn.',
        MIGRATION_FAILED: 'Không thể nâng cấp dự án Story Studio cũ. Dữ liệu cũ vẫn được giữ nguyên để thử lại.',
        LEGACY_CLEANUP_FAILED: 'Dự án đã được nâng cấp an toàn, nhưng bản lưu cũ chưa thể dọn. Hãy tải lại trang.',
        PROJECT_NOT_FOUND: 'Dự án đã chọn không còn trong thư viện.',
        PROJECT_UNAVAILABLE: 'Dự án đã chọn bị thiếu hoặc không hợp lệ. Canon khác không bị thay đổi.',
        PROJECT_OPERATION_BLOCKED: 'Hãy chờ bước model hoặc lưu hiện tại hoàn tất trước khi đổi thư viện.',
        MALFORMED_JSON: 'Gemini trả về JSON không hợp lệ; dự án chưa được tạo.',
        EMPTY_RESPONSE: 'Gemini không trả về bản biên dịch setup.',
        SETUP_SOURCE_SIZE_INVALID: 'Tệp setup trống hoặc vượt giới hạn an toàn 2 MiB.',
        UNSUPPORTED_SETUP_FILE: 'Story Studio chỉ nhận tệp V4 JSON, TXT hoặc MD.',
        SETUP_COMPILER_FAILED: 'Gemini chưa biên dịch được setup TXT/MD. Dự án hiện tại vẫn được giữ nguyên.',
        SETUP_BLUEPRINT_PARSE_FAILED: 'Kết quả Gemini không đúng cấu trúc Blueprint V4 nghiêm ngặt. Dự án chưa được tạo.',
        SETUP_CONTROL_COMPILE_FAILED: 'Blueprint đã đọc được nhưng không vượt qua kiểm tra StoryControl. Dự án chưa được tạo.',
        SETUP_REVIEW_BUILD_FAILED: 'StoryControl hợp lệ nhưng không thể tạo bản review setup an toàn. Dự án chưa được tạo.',
    };
    return messages[code] ?? 'Không thể hoàn tất thao tác. Canon hiện tại vẫn an toàn.';
};

const operationForStage = (stage: StoryStudioRuntimeProject['workflow']['stage']): StoryStudioOperation => {
    if (stage === 'idle') return 'planning';
    if (stage === 'planned') return 'writing';
    if (stage === 'drafted') return 'validation';
    if (stage === 'validated') return 'extraction';
    return 'canon-review';
};

export const useStoryStudio = ({ enabledModels, addToast, onOpenGeminiSettings }: UseStoryStudioProps) => {
    const [controller] = useState(() => new StoryStudioProjectController());
    const [wizardDraftRepository] = useState(() => new StorySetupWizardDraftRepository());
    const abortRef = useRef<AbortController | null>(null);
    const stopRequestedRef = useRef(false);
    const mountedRef = useRef(true);

    const [loadStatus, setLoadStatus] = useState<StoryStudioLoadStatus>('loading');
    const [project, setProject] = useState<StoryStudioRuntimeProject>();
    const [projectLibrary, setProjectLibrary] = useState<readonly StoryStudioProjectLibraryViewEntry[]>([]);
    const [hasValidProjectLibrary, setHasValidProjectLibrary] = useState(false);
    const [activeProjectId, setActiveProjectId] = useState<StoryStudioProjectId>();
    const [showDemo, setShowDemo] = useState(false);
    const [saveStatus, setSaveStatus] = useState<StoryStudioSaveStatus>('saved');
    const [operation, setOperation] = useState<StoryStudioOperation>();
    const [recoveryWarning, setRecoveryWarning] = useState(false);
    const [recoveryUi, dispatchRecoveryUi] = useReducer(reduceStoryStudioRecoveryUiState, {});
    const { errorMessage, recoveryTarget } = recoveryUi;
    const setErrorMessage = useCallback((value: undefined) => {
        void value;
        dispatchRecoveryUi({ type: 'clear-error' });
    }, []);
    const [preparedImport, setPreparedImport] = useState<PreparedStorySetupImport>();
    const [preparedImportFromWizard, setPreparedImportFromWizard] = useState(false);
    const [preparedImportOrigin, setPreparedImportOrigin] = useState<StoryStudioPreparedImportOrigin>();
    const [importDisplayName, setImportDisplayName] = useState('');
    const [makeCanonConfirmationOpen, setMakeCanonConfirmationOpen] = useState(false);
    const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
    const [batchSize, setBatchSizeState] = useState<StoryStudioBatchSize>(2);
    const [wizardDraft, setWizardDraft] = useState<StorySetupWizardDraftV1>();
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardOrigin, setWizardOrigin] = useState<StoryStudioPreparedImportOrigin>();
    const [wizardDraftLoadStatus, setWizardDraftLoadStatus] = useState<'loading' | 'empty' | 'loaded' | 'corrupt'>('loading');
    const [wizardDraftSaveStatus, setWizardDraftSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

    useEffect(() => {
        mountedRef.current = true;
        void Promise.all([controller.load(), wizardDraftRepository.load()]).then(([result, draftResult]) => {
            if (!mountedRef.current) return;
            setProjectLibrary(result.library?.entries ?? []);
            setHasValidProjectLibrary(result.library !== undefined);
            setActiveProjectId(result.library?.index.activeProjectId);
            setWizardDraftLoadStatus(draftResult.status);
            if (draftResult.status === 'loaded') {
                setWizardDraft(draftResult.draft);
                const restoredOrigin = getStoryStudioPreparedImportOrigin(
                    result.status === 'core-corrupt' ? 'core-corrupt' : result.status === 'empty' ? 'empty' : 'connected',
                    result.library !== undefined,
                );
                if (restoredOrigin) {
                    setWizardOrigin(restoredOrigin);
                    setWizardOpen(true);
                }
            }
            if (result.status === 'empty') {
                setLoadStatus('empty');
                return;
            }
            if (result.status === 'core-corrupt') {
                setLoadStatus('core-corrupt');
                dispatchRecoveryUi({
                    type: 'core-corrupt',
                    errorMessage: getStoryStudioSafeMessage(result.error),
                    recoveryTarget: result.recoveryTarget,
                });
                return;
            }
            dispatchRecoveryUi({ type: 'connected' });
            setProject(result.project);
            setBatchSizeState(result.project.batchQueue.requestedSize);
            setRecoveryWarning(result.status === 'workflow-recovered');
            setLoadStatus('connected');
        });
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, [controller, wizardDraftRepository]);

    const publish = useCallback((next: StoryStudioRuntimeProject) => {
        if (!mountedRef.current) return;
        setProject(next);
        setLoadStatus('connected');
        setSaveStatus('saved');
        setProjectLibrary(controller.projectLibrary);
        setHasValidProjectLibrary(true);
        setActiveProjectId(controller.activeProjectId);
        dispatchRecoveryUi({ type: 'connected' });
    }, [controller]);

    const handleError = useCallback((error: unknown) => {
        logSafeStorySetupImportDiagnostic(error);
        logSafeStoryStudioRuntimeDiagnostic(error);
        const message = getStoryStudioSafeMessage(error);
        if (mountedRef.current) {
            dispatchRecoveryUi({ type: 'operation-error', errorMessage: message });
            setSaveStatus((typeof error === 'object' && error !== null && 'code' in error && error.code === 'SAVE_FAILED') ? 'error' : 'saved');
        }
        addToast(message, 'error');
    }, [addToast]);

    const runPipeline = useCallback(async () => {
        if (abortRef.current || !controller.currentProject) return;
        const abortController = new AbortController();
        abortRef.current = abortController;
        stopRequestedRef.current = false;
        try {
            const runtime = createGeminiProductionStoryRuntime({
                availableModelIds: enabledModels, signal: abortController.signal,
            });
            while (!abortController.signal.aborted) {
                const current = controller.currentProject;
                if (!current || current.workflow.stage === 'ready-for-canon-review' || current.workflow.stage === 'rejected') break;
                if (current.batchQueue.paused) break;
                setOperation(operationForStage(current.workflow.stage));
                const result = await controller.runNextStage(runtime);
                publish(result.project);
                if (result.reachedHumanReview || result.rejected) break;
            }
        } catch (error) {
            handleError(error);
        } finally {
            abortRef.current = null;
            if (stopRequestedRef.current && controller.currentProject) {
                try {
                    setSaveStatus('saving');
                    publish(await controller.pauseBatch());
                } catch (error) { handleError(error); }
            }
            if (mountedRef.current) setOperation(undefined);
        }
    }, [controller, enabledModels, handleError, publish]);

    const importFile = useCallback(async (file: File) => {
        if (abortRef.current || operation) return;
        const origin = getStoryStudioPreparedImportOrigin(loadStatus, hasValidProjectLibrary);
        if (!origin) return;
        if (origin === 'normal') setErrorMessage(undefined);
        let compilerAbortController: AbortController | undefined;
        try {
            const source = await file.text();
            let prepared: PreparedStorySetupImport;
            if (/\.json$/i.test(file.name)) {
                prepared = prepareJsonStorySetupImport(source, file.name);
            } else if (/\.(?:txt|md)$/i.test(file.name)) {
                compilerAbortController = new AbortController();
                abortRef.current = compilerAbortController;
                stopRequestedRef.current = false;
                setOperation('compiling-setup');
                prepared = await prepareAuthorTextStorySetupImport(source, file.name, {
                    availableModelIds: enabledModels,
                    signal: compilerAbortController.signal,
                });
                if (compilerAbortController.signal.aborted) return;
            } else {
                throw new StorySetupImportError('UNSUPPORTED_SETUP_FILE');
            }
            setPreparedImport(prepared);
            setPreparedImportFromWizard(false);
            setPreparedImportOrigin(origin);
            setImportDisplayName(prepared.review.displayName);
        } catch (error) {
            handleError(error);
        } finally {
            if (compilerAbortController && abortRef.current === compilerAbortController) abortRef.current = null;
            setOperation(undefined);
        }
    }, [enabledModels, handleError, hasValidProjectLibrary, loadStatus, operation, setErrorMessage]);

    const openWizard = useCallback(async () => {
        if (abortRef.current || operation) return;
        const origin = getStoryStudioPreparedImportOrigin(loadStatus, hasValidProjectLibrary);
        if (!origin) return;
        if (wizardDraftLoadStatus === 'corrupt') {
            const confirmed = window.confirm('Bản nháp tạo truyện đã lưu bị lỗi và không thể mở. Bạn có muốn chỉ xóa bản nháp này để bắt đầu lại?');
            if (!confirmed) return;
            try {
                await wizardDraftRepository.clear();
                setWizardDraftLoadStatus('empty');
            } catch (error) {
                handleError(error);
                return;
            }
        }
        const next = wizardDraft ?? createEmptyStorySetupWizardDraft();
        if (!wizardDraft) {
            setWizardDraftSaveStatus('saving');
            try {
                await wizardDraftRepository.save(next);
                setWizardDraft(next);
                setWizardDraftLoadStatus('loaded');
                setWizardDraftSaveStatus('saved');
            } catch (error) {
                setWizardDraftSaveStatus('error');
                handleError(error);
                return;
            }
        }
        setWizardOrigin(origin);
        setWizardOpen(true);
        if (origin === 'normal') setErrorMessage(undefined);
    }, [handleError, hasValidProjectLibrary, loadStatus, operation, setErrorMessage, wizardDraft, wizardDraftLoadStatus, wizardDraftRepository]);

    const updateWizardDraft = useCallback((next: StorySetupWizardDraftV1) => {
        setWizardDraft(next);
        setWizardDraftSaveStatus('saving');
        void wizardDraftRepository.save(next).then(() => {
            if (mountedRef.current) {
                setWizardDraftLoadStatus('loaded');
                setWizardDraftSaveStatus('saved');
            }
        }).catch(() => {
            if (mountedRef.current) setWizardDraftSaveStatus('error');
            addToast('Không thể lưu bản nháp tạo truyện. Dữ liệu dự án hiện tại không thay đổi.', 'error');
        });
    }, [addToast, wizardDraftRepository]);

    const discardWizardDraft = useCallback(async () => {
        if (!window.confirm('Xóa riêng bản nháp tạo truyện này? Các dự án Story Studio không bị ảnh hưởng.')) return;
        try {
            await wizardDraftRepository.clear();
            setWizardDraft(undefined);
            setWizardDraftLoadStatus('empty');
            setWizardDraftSaveStatus('saved');
            setWizardOpen(false);
            setWizardOrigin(undefined);
        } catch (error) { handleError(error); }
    }, [handleError, wizardDraftRepository]);

    const compileWizardDraft = useCallback(async () => {
        if (!wizardDraft || validateStorySetupWizardDraft(wizardDraft).length > 0 || abortRef.current || operation) return;
        const origin = wizardOrigin ?? getStoryStudioPreparedImportOrigin(loadStatus, hasValidProjectLibrary);
        if (!origin) return;
        const compilerAbortController = new AbortController();
        abortRef.current = compilerAbortController;
        setOperation('compiling-setup');
        try {
            const prepared = await prepareAuthorTextStorySetupImport(
                renderStorySetupWizardMarkdown(wizardDraft),
                'story-setup-wizard.md',
                { availableModelIds: enabledModels, signal: compilerAbortController.signal },
            );
            if (compilerAbortController.signal.aborted) return;
            setPreparedImport(prepared);
            setPreparedImportFromWizard(true);
            setPreparedImportOrigin(origin);
            setImportDisplayName(wizardDraft.basic.title.trim() || prepared.review.displayName);
            setWizardOpen(false);
        } catch (error) {
            handleError(error);
            if (origin === 'verified-core-corrupt-library') setWizardOpen(false);
        } finally {
            if (abortRef.current === compilerAbortController) abortRef.current = null;
            setOperation(undefined);
        }
    }, [enabledModels, handleError, hasValidProjectLibrary, loadStatus, operation, wizardDraft, wizardOrigin]);

    const finishCreate = useCallback(async () => {
        if (!preparedImport || preparedImport.review.criticalIssues.length > 0) return;
        setSaveStatus('saving');
        try {
            if (preparedImportFromWizard) {
                const result = await completeDurableWizardCreate(
                    () => controller.createProject(preparedImport.setupDocument, importDisplayName),
                    publish,
                    () => wizardDraftRepository.clear(),
                );
                if (result.draftCleared) {
                    setWizardDraft(undefined);
                    setWizardDraftLoadStatus('empty');
                    setWizardDraftSaveStatus('saved');
                } else {
                    addToast('Dự án đã được tạo an toàn, nhưng bản nháp cục bộ chưa thể xóa.', 'info');
                }
            } else {
                const next = await controller.createProject(preparedImport.setupDocument, importDisplayName);
                publish(next);
            }
            setWizardOpen(false);
            setWizardOrigin(undefined);
            setPreparedImport(undefined);
            setPreparedImportFromWizard(false);
            setPreparedImportOrigin(undefined);
            setShowDemo(false);
            addToast(preparedImportFromWizard ? 'Đã tạo và lưu truyện mới.' : 'Đã tạo và lưu dự án Story Engine V4.', 'success');
        } catch (error) { handleError(error); }
    }, [addToast, controller, handleError, importDisplayName, preparedImport, preparedImportFromWizard, publish, wizardDraftRepository]);

    const startBatch = useCallback(async () => {
        if (abortRef.current) return;
        await runStoryStudioProductionAttempt('startBatch', setErrorMessage, async () => {
            setSaveStatus('saving');
            try {
                publish(await controller.startBatch(batchSize));
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [batchSize, controller, handleError, publish, runPipeline, setErrorMessage]);

    const resume = useCallback(async () => {
        if (abortRef.current || !controller.currentProject) return;
        await runStoryStudioProductionAttempt('resume', setErrorMessage, async () => {
            try {
                if (controller.currentProject?.batchQueue.paused) {
                    setSaveStatus('saving');
                    publish(await controller.resumeBatch());
                }
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [controller, handleError, publish, runPipeline, setErrorMessage]);

    const stop = useCallback(() => {
        if (!abortRef.current) return;
        stopRequestedRef.current = true;
        setOperation('stopping');
        abortRef.current.abort();
    }, []);

    const rewriteFromSamePlan = useCallback(async () => {
        await runStoryStudioProductionAttempt('rewriteFromSamePlan', setErrorMessage, async () => {
            try {
                setSaveStatus('saving');
                publish(await controller.rewriteFromSamePlan());
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [controller, handleError, publish, runPipeline, setErrorMessage]);

    const replan = useCallback(async () => {
        await runStoryStudioProductionAttempt('replan', setErrorMessage, async () => {
            try {
                setSaveStatus('saving');
                publish(await controller.replanCurrentChapter());
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [controller, handleError, publish, runPipeline, setErrorMessage]);

    const confirmMakeCanon = useCallback(async () => {
        setMakeCanonConfirmationOpen(false);
        setSaveStatus('saving');
        try {
            // This structured confirmation is created only from the positive modal action.
            const confirmation = controller.createConfirmation();
            const result = await controller.makeCanonDurably(confirmation);
            publish(result.project);
            addToast(`Đã Make Canon chương ${result.project.state.currentChapter}.`, 'success');
            if (result.shouldContinueBatch) await runPipeline();
        } catch (error) {
            const durable = controller.currentProject;
            if (durable) publish(durable);
            handleError(error);
        }
    }, [addToast, controller, handleError, publish, runPipeline]);

    const deleteProject = useCallback(async () => {
        setDeleteConfirmationOpen(false);
        try {
            setSaveStatus('saving');
            const recoveryDeleteTarget = getStoryStudioRecoveryDeleteTarget(loadStatus, recoveryTarget);
            const result = recoveryDeleteTarget?.kind === 'legacy-single-project'
                ? await controller.deleteCorruptLegacyProject()
                : await controller.deleteProject(
                    recoveryDeleteTarget?.kind === 'active-library-project' ? recoveryDeleteTarget.projectId : undefined,
                );
            setPreparedImport(undefined);
            setPreparedImportFromWizard(false);
            setPreparedImportOrigin(undefined);
            setProjectLibrary(result.library?.entries ?? []);
            setHasValidProjectLibrary(result.library !== undefined);
            setActiveProjectId(result.library?.index.activeProjectId);
            if (result.status === 'core-corrupt') {
                dispatchRecoveryUi({
                    type: 'core-corrupt',
                    errorMessage: getStoryStudioSafeMessage(result.error),
                    recoveryTarget: result.recoveryTarget,
                });
            } else {
                dispatchRecoveryUi({ type: 'connected' });
            }
            if (result.status === 'loaded' || result.status === 'workflow-recovered') {
                setProject(result.project);
                setBatchSizeState(result.project.batchQueue.requestedSize);
                setLoadStatus('connected');
                setRecoveryWarning(result.status === 'workflow-recovered');
            } else {
                setProject(undefined);
                setLoadStatus(result.status === 'core-corrupt' ? 'core-corrupt' : 'empty');
                setRecoveryWarning(false);
            }
            setSaveStatus('saved');
            addToast('Đã xóa riêng dự án V4 khỏi trình duyệt này.', 'info');
        } catch (error) { handleError(error); }
    }, [addToast, controller, handleError, loadStatus, recoveryTarget]);

    const switchProject = useCallback(async (projectId: StoryStudioProjectId) => {
        setSaveStatus('saving');
        try {
            const result = await controller.switchProject(projectId);
            publish(result.project);
            setBatchSizeState(result.project.batchQueue.requestedSize);
            setRecoveryWarning(result.workflowRecovered);
        } catch (error) { handleError(error); }
    }, [controller, handleError, publish]);

    const renameActiveProject = useCallback(async (displayName: string) => {
        setSaveStatus('saving');
        try {
            publish(await controller.updateDisplayName(displayName));
            addToast('Đã đổi tên dự án Story Studio.', 'success');
        } catch (error) { handleError(error); }
    }, [addToast, controller, handleError, publish]);

    const viewModel = useMemo(() => {
        if (showDemo) return STORY_STUDIO_DEMO_VIEW_MODEL;
        if (project) {
            const catalogDisplayName = projectLibrary.find(entry => entry.projectId === activeProjectId)?.displayName;
            return buildStoryStudioViewModel(buildConnectedStoryStudioSession(project, catalogDisplayName));
        }
        return buildStoryStudioViewModel(EMPTY_STORY_STUDIO_SESSION);
    }, [activeProjectId, project, projectLibrary, showDemo]);

    const setBatchSize = useCallback((value: number) => {
        if (value === 1 || value === 2 || value === 3) setBatchSizeState(value);
    }, []);

    const downloadBlankTemplate = useCallback(() => {
        downloadStorySetupMarkdown('MAU-STORY-SETUP', STORY_SETUP_BLANK_TEMPLATE_MARKDOWN);
    }, []);

    const downloadWizardMarkdown = useCallback(() => {
        if (wizardDraft) downloadStorySetupMarkdown(wizardDraft.basic.title || 'story-setup-wizard', renderStorySetupWizardMarkdown(wizardDraft));
    }, [wizardDraft]);

    const exportActiveSetup = useCallback(() => {
        const current = controller.currentProject;
        if (!current) return;
        const confirmed = window.confirm('Tệp Setup có thể chứa spoiler và Bí mật chỉ dành cho tác giả. Đây chỉ là thiết kế truyện; nhập lại sẽ tạo dự án mới từ C0, không phải bản sao lưu tiếp tục. Tiếp tục tải?');
        if (!confirmed) return;
        const displayName = projectLibrary.find(entry => entry.projectId === activeProjectId)?.displayName ?? current.displayName;
        downloadStorySetupMarkdown(displayName + '-setup', renderExistingProjectSetupMarkdown(current.setupDocument, displayName));
    }, [activeProjectId, controller, projectLibrary]);

    return {
        loadStatus, project, projectLibrary, activeProjectId, showDemo, setShowDemo, viewModel, saveStatus, operation,
        errorMessage, setErrorMessage, recoveryWarning, recoveryTarget,
        preparedImport, preparedImportOrigin, hasValidProjectLibrary, importDisplayName, setImportDisplayName, importFile,
        cancelImport: () => {
            if (preparedImportFromWizard && preparedImportOrigin === 'normal') setWizardOpen(true);
            setPreparedImport(undefined);
            setPreparedImportOrigin(undefined);
            setPreparedImportFromWizard(false);
        },
        wizardDraft, wizardOpen, wizardOrigin, wizardDraftLoadStatus, wizardDraftSaveStatus,
        openWizard, updateWizardDraft, closeWizard: () => setWizardOpen(false), discardWizardDraft, compileWizardDraft,
        downloadBlankTemplate, downloadWizardMarkdown, exportActiveSetup,
        finishCreate, switchProject, renameActiveProject,
        batchSize, setBatchSize, startBatch, resume, stop, rewriteFromSamePlan, replan,
        makeCanonConfirmationOpen, setMakeCanonConfirmationOpen, confirmMakeCanon,
        deleteConfirmationOpen, setDeleteConfirmationOpen, deleteProject, onOpenGeminiSettings,
    };
};
