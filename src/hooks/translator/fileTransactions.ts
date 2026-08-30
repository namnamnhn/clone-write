import { FileItem, FileStatus } from '../../types';

export type FileTransactionKind = 'translate' | 'retranslate' | 'postprocess';
export interface FileTransactionSnapshot { runId: number; kind: FileTransactionKind; original: FileItem; }
export type FileTransactionStore = Map<string, FileTransactionSnapshot>;

export const beginFileTransactions = (store: FileTransactionStore, files: FileItem[], runId: number, kind: FileTransactionKind): void => {
    files.forEach(file => {
        const existing = store.get(file.id);
        if (existing?.runId === runId) return;
        store.set(file.id, { runId, kind, original: { ...file } });
    });
};

const restoreTranslationFields = (current: FileItem, original: FileItem): FileItem => ({
    ...current, translatedContent: original.translatedContent,
    remainingRawCharCount: original.remainingRawCharCount, usedModel: original.usedModel,
    processingDuration: original.processingDuration, integrityRatio: original.integrityRatio,
    isFragmentedSource: original.isFragmentedSource,
    integrityOverrideAccepted: original.integrityOverrideAccepted, ratioWarning: original.ratioWarning,
    hasStaleTranslation: original.hasStaleTranslation, isRescueLocked: original.isRescueLocked,
    rawFixAttemptCount: original.rawFixAttemptCount, titleGeneratedByAI: original.titleGeneratedByAI,
});

const restoreFullTransactionState = (current: FileItem, original: FileItem): FileItem => ({
    ...restoreTranslationFields(current, original), status: original.status,
    errorMessage: original.errorMessage, retryCount: original.retryCount,
});

export const settleBatchFileTransactions = (files: FileItem[], fileIds: Iterable<string>, store: FileTransactionStore, runId: number): FileItem[] => {
    const ids = new Set(fileIds); let changed = false;
    const next = files.map(file => {
        if (!ids.has(file.id)) return file;
        const snapshot = store.get(file.id);
        if (!snapshot || snapshot.runId !== runId) return file;
        if (file.status === FileStatus.COMPLETED && !!file.translatedContent?.trim()) { store.delete(file.id); return file; }
        const restored = restoreTranslationFields(file, snapshot.original);
        if (file.status === FileStatus.ERROR) store.delete(file.id);
        changed = true; return restored;
    });
    return changed ? next : files;
};

export const rollbackBatchFileTransactions = (files: FileItem[], fileIds: Iterable<string>, store: FileTransactionStore, runId: number): FileItem[] => {
    const ids = new Set(fileIds); let changed = false;
    const next = files.map(file => {
        if (!ids.has(file.id)) return file;
        const snapshot = store.get(file.id);
        if (!snapshot || snapshot.runId !== runId) return file;
        changed = true; return restoreTranslationFields(file, snapshot.original);
    });
    return changed ? next : files;
};

export const rollbackAndCloseFileTransactions = (files: FileItem[], fileIds: Iterable<string>, store: FileTransactionStore, runId?: number): FileItem[] => {
    const ids = new Set(fileIds); let changed = false;
    const next = files.map(file => {
        if (!ids.has(file.id)) return file;
        const snapshot = store.get(file.id);
        if (!snapshot || (runId !== undefined && snapshot.runId !== runId)) return file;
        store.delete(file.id); changed = true; return restoreFullTransactionState(file, snapshot.original);
    });
    return changed ? next : files;
};

export const rollbackAndCloseAllFileTransactions = (files: FileItem[], store: FileTransactionStore): FileItem[] =>
    rollbackAndCloseFileTransactions(files, Array.from(store.keys()), store);

export const commitFileTransactions = (store: FileTransactionStore, fileIds: Iterable<string>, runId?: number): void => {
    for (const id of fileIds) {
        const snapshot = store.get(id);
        if (snapshot && (runId === undefined || snapshot.runId === runId)) store.delete(id);
    }
};
