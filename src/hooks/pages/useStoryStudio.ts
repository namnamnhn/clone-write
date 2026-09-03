import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGeminiProductionStoryRuntime } from '../../services/storyEngine';
import { buildStoryStudioViewModel } from '../../storyStudio/storyStudioPresenter';
import { EMPTY_STORY_STUDIO_SESSION, STORY_STUDIO_DEMO_VIEW_MODEL } from '../../storyStudio/storyStudioDemoViewModel';
import { StoryStudioProjectController } from '../../storyStudio/production/storyStudioProjectController';
import type { StoryStudioRuntimeProject } from '../../storyStudio/production/storyStudioProjectTypes';
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

export const runStoryStudioProductionAttempt = async <T>(
    attempt: StoryStudioExplicitAttempt,
    clearError: (value: undefined) => void,
    run: (attempt: StoryStudioExplicitAttempt) => Promise<T>,
): Promise<T> => {
    clearError(undefined);
    return run(attempt);
};

const safeMessage = (error: unknown): string => {
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
        WRITER_PROTOCOL_FAILURE: 'Writer không tạo được bản nháp hợp lệ.',
        VALIDATOR_INFRASTRUCTURE_FAILURE: 'Validator gặp lỗi hạ tầng. Canon chưa thay đổi.',
        MODEL_RUNTIME_FAILURE: 'Gemini gặp lỗi khi xử lý. Canon chưa thay đổi.',
        VALIDATION_REJECTED: 'Bản nháp không được Validator chấp thuận.',
        EXTRACTION_BLOCKED: 'Không thể tạo đề xuất Canon an toàn từ chương này.',
        CANON_REVIEW_BLOCKED: 'Đề xuất Canon không vượt qua kiểm tra review.',
        CANCELLED: 'Đã dừng an toàn. Canon và bộ nhớ không thay đổi.',
        SAVE_FAILED: 'Không thể lưu dự án vào trình duyệt. Trạng thái bền vững trước đó vẫn được giữ nguyên.',
        LOAD_FAILED: 'Không thể đọc dự án V4 đã lưu trên trình duyệt này.',
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
    const abortRef = useRef<AbortController | null>(null);
    const stopRequestedRef = useRef(false);
    const mountedRef = useRef(true);

    const [loadStatus, setLoadStatus] = useState<StoryStudioLoadStatus>('loading');
    const [project, setProject] = useState<StoryStudioRuntimeProject>();
    const [showDemo, setShowDemo] = useState(false);
    const [saveStatus, setSaveStatus] = useState<StoryStudioSaveStatus>('saved');
    const [operation, setOperation] = useState<StoryStudioOperation>();
    const [errorMessage, setErrorMessage] = useState<string>();
    const [recoveryWarning, setRecoveryWarning] = useState(false);
    const [preparedImport, setPreparedImport] = useState<PreparedStorySetupImport>();
    const [importDisplayName, setImportDisplayName] = useState('');
    const [replacementConfirmationOpen, setReplacementConfirmationOpen] = useState(false);
    const [makeCanonConfirmationOpen, setMakeCanonConfirmationOpen] = useState(false);
    const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
    const [batchSize, setBatchSizeState] = useState<StoryStudioBatchSize>(2);

    useEffect(() => {
        mountedRef.current = true;
        void controller.load().then((result) => {
            if (!mountedRef.current) return;
            if (result.status === 'empty') {
                setLoadStatus('empty');
                return;
            }
            if (result.status === 'core-corrupt') {
                setLoadStatus('core-corrupt');
                setErrorMessage(safeMessage(result.error));
                return;
            }
            setProject(result.project);
            setBatchSizeState(result.project.batchQueue.requestedSize);
            setRecoveryWarning(result.status === 'workflow-recovered');
            setLoadStatus('connected');
        });
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, [controller]);

    const publish = useCallback((next: StoryStudioRuntimeProject) => {
        if (!mountedRef.current) return;
        setProject(next);
        setLoadStatus('connected');
        setSaveStatus('saved');
    }, []);

    const handleError = useCallback((error: unknown) => {
        logSafeStorySetupImportDiagnostic(error);
        logSafeStoryStudioRuntimeDiagnostic(error);
        const message = safeMessage(error);
        if (mountedRef.current) {
            setErrorMessage(message);
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
        setErrorMessage(undefined);
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
            setImportDisplayName(prepared.review.displayName);
        } catch (error) {
            handleError(error);
        } finally {
            if (compilerAbortController && abortRef.current === compilerAbortController) abortRef.current = null;
            setOperation(undefined);
        }
    }, [enabledModels, handleError, operation]);

    const finishCreate = useCallback(async (confirmReplacement: boolean) => {
        if (!preparedImport || preparedImport.review.criticalIssues.length > 0) return;
        setSaveStatus('saving');
        try {
            const next = await controller.createProject(preparedImport.setupDocument, importDisplayName, confirmReplacement);
            publish(next);
            setPreparedImport(undefined);
            setReplacementConfirmationOpen(false);
            setShowDemo(false);
            addToast('Đã tạo và lưu dự án Story Engine V4.', 'success');
        } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
            if (code === 'PROJECT_REPLACEMENT_CONFIRMATION_REQUIRED') {
                setSaveStatus('saved');
                setReplacementConfirmationOpen(true);
            } else handleError(error);
        }
    }, [addToast, controller, handleError, importDisplayName, preparedImport, publish]);

    const startBatch = useCallback(async () => {
        if (abortRef.current) return;
        await runStoryStudioProductionAttempt('startBatch', setErrorMessage, async () => {
            setSaveStatus('saving');
            try {
                publish(await controller.startBatch(batchSize));
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [batchSize, controller, handleError, publish, runPipeline]);

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
    }, [controller, handleError, publish, runPipeline]);

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
    }, [controller, handleError, publish, runPipeline]);

    const replan = useCallback(async () => {
        await runStoryStudioProductionAttempt('replan', setErrorMessage, async () => {
            try {
                setSaveStatus('saving');
                publish(await controller.replanCurrentChapter());
                await runPipeline();
            } catch (error) { handleError(error); }
        });
    }, [controller, handleError, publish, runPipeline]);

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
            await controller.deleteProject();
            setProject(undefined);
            setPreparedImport(undefined);
            setLoadStatus('empty');
            setRecoveryWarning(false);
            setSaveStatus('saved');
            addToast('Đã xóa riêng dự án V4 khỏi trình duyệt này.', 'info');
        } catch (error) { handleError(error); }
    }, [addToast, controller, handleError]);

    const viewModel = useMemo(() => {
        if (showDemo) return STORY_STUDIO_DEMO_VIEW_MODEL;
        if (project) return buildStoryStudioViewModel(buildConnectedStoryStudioSession(project));
        return buildStoryStudioViewModel(EMPTY_STORY_STUDIO_SESSION);
    }, [project, showDemo]);

    const setBatchSize = useCallback((value: number) => {
        if (value === 1 || value === 2 || value === 3) setBatchSizeState(value);
    }, []);

    return {
        loadStatus, project, showDemo, setShowDemo, viewModel, saveStatus, operation,
        errorMessage, setErrorMessage, recoveryWarning,
        preparedImport, importDisplayName, setImportDisplayName, importFile,
        cancelImport: () => { setPreparedImport(undefined); setReplacementConfirmationOpen(false); },
        finishCreate, replacementConfirmationOpen, setReplacementConfirmationOpen,
        batchSize, setBatchSize, startBatch, resume, stop, rewriteFromSamePlan, replan,
        makeCanonConfirmationOpen, setMakeCanonConfirmationOpen, confirmMakeCanon,
        deleteConfirmationOpen, setDeleteConfirmationOpen, deleteProject, onOpenGeminiSettings,
    };
};
