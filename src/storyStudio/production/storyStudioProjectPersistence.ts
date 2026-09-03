import { clearSessionRecord, loadFromStorage, saveToStorage } from '../../utils/storage';
import {
    STORY_STUDIO_STORAGE_KEY,
    StoryStudioProjectError,
} from './storyStudioProjectTypes';
import type {
    StoryStudioProjectDocumentV1,
    StoryStudioProjectLoadResult,
    StoryStudioRuntimeProject,
} from './storyStudioProjectTypes';
import { parseStoryStudioProjectDocument, withoutRuntimeControl } from './storyStudioProjectRuntime';

export interface StoryStudioStorageAdapter {
    load(key: string): Promise<unknown | null | undefined>;
    save(key: string, value: StoryStudioProjectDocumentV1): Promise<void>;
    clear(key: string): Promise<void>;
}
export const STORY_STUDIO_INDEXED_DB_ADAPTER: StoryStudioStorageAdapter = {
    load: key => loadFromStorage(key),
    save: (key, value) => saveToStorage(key, value),
    clear: key => clearSessionRecord(key),
};

/** One serialized write lane prevents an older snapshot from completing after a newer one. */
export class StoryStudioProjectRepository {
    private writeLane: Promise<void> = Promise.resolve();

    constructor(
        private readonly adapter: StoryStudioStorageAdapter = STORY_STUDIO_INDEXED_DB_ADAPTER,
        private readonly storageKey = STORY_STUDIO_STORAGE_KEY,
    ) {}

    async load(): Promise<StoryStudioProjectLoadResult> {
        let value: unknown;
        try {
            value = await this.adapter.load(this.storageKey);
        } catch {
            return { status: 'core-corrupt', error: new StoryStudioProjectError('LOAD_FAILED') };
        }
        if (value === null || value === undefined) return { status: 'empty' };
        try {
            const parsed = parseStoryStudioProjectDocument(value);
            return parsed.workflowRecovered
                ? { status: 'workflow-recovered', project: parsed.project, warning: 'WORKFLOW_CORRUPT_OR_STALE' }
                : { status: 'loaded', project: parsed.project };
        } catch (error) {
            return {
                status: 'core-corrupt',
                error: error instanceof StoryStudioProjectError ? error : new StoryStudioProjectError('INVALID_PROJECT'),
            };
        }
    }

    save(project: StoryStudioRuntimeProject): Promise<void> {
        const snapshot = withoutRuntimeControl(project);
        const operation = this.writeLane.catch(() => undefined).then(async () => {
            try {
                await this.adapter.save(this.storageKey, snapshot);
            } catch {
                throw new StoryStudioProjectError('SAVE_FAILED');
            }
        });
        this.writeLane = operation.catch(() => undefined);
        return operation;
    }

    delete(): Promise<void> {
        const operation = this.writeLane.catch(() => undefined).then(async () => {
            try {
                await this.adapter.clear(this.storageKey);
            } catch {
                throw new StoryStudioProjectError('SAVE_FAILED');
            }
        });
        this.writeLane = operation.catch(() => undefined);
        return operation;
    }
}

export class InMemoryStoryStudioStorageAdapter implements StoryStudioStorageAdapter {
    readonly values = new Map<string, StoryStudioProjectDocumentV1>();
    failNextLoad = false;
    failNextSave = false;
    failNextClear = false;

    async load(key: string): Promise<unknown | null> {
        if (this.failNextLoad) { this.failNextLoad = false; throw new Error('load failed'); }
        const value = this.values.get(key);
        return value === undefined ? null : structuredClone(value);
    }

    async save(key: string, value: StoryStudioProjectDocumentV1): Promise<void> {
        if (this.failNextSave) { this.failNextSave = false; throw new Error('save failed'); }
        this.values.set(key, structuredClone(value));
    }

    async clear(key: string): Promise<void> {
        if (this.failNextClear) { this.failNextClear = false; throw new Error('clear failed'); }
        this.values.delete(key);
    }
}
