import {
    clearSessionRecord,
    commitSessionRecords,
    loadFromStorage,
    saveToStorage,
} from '../../utils/storage';
import {
    STORY_STUDIO_PROJECT_KEY_PREFIX,
    STORY_STUDIO_PROJECT_LIBRARY_KEY,
    STORY_STUDIO_STORAGE_KEY,
    StoryStudioProjectError,
} from './storyStudioProjectTypes';
import type {
    StoryStudioProjectId,
    StoryStudioProjectLibraryEntry,
    StoryStudioProjectLibraryIndexV1,
    StoryStudioProjectLibrarySnapshot,
    StoryStudioProjectLibraryViewEntry,
    StoryStudioProjectLoadResult,
    StoryStudioRuntimeProject,
} from './storyStudioProjectTypes';
import {
    parseStoryStudioProjectDocument,
    withoutRuntimeControl,
} from './storyStudioProjectRuntime';
import type { PersistedStoryStudioWorkflow } from './storyStudioWorkflowTypes';

export interface StoryStudioStorageWrite {
    readonly key: string;
    readonly value: unknown;
}

export interface StoryStudioStorageAdapter {
    load(key: string): Promise<unknown | null | undefined>;
    save(key: string, value: unknown): Promise<void>;
    clear(key: string): Promise<void>;
    commit(writes: readonly StoryStudioStorageWrite[], clears?: readonly string[]): Promise<void>;
}

export const STORY_STUDIO_INDEXED_DB_ADAPTER: StoryStudioStorageAdapter = {
    load: key => loadFromStorage(key),
    save: (key, value) => saveToStorage(key, value),
    clear: key => clearSessionRecord(key),
    commit: (writes, clears = []) => commitSessionRecords(writes, clears),
};

type UnknownRecord = Record<string, unknown>;

const exactObject = (value: unknown, keys: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    const input = value as UnknownRecord;
    if (Object.keys(input).some(key => !keys.includes(key))) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return input;
};

const nonEmptyText = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return value;
};

const isoDate = (value: unknown): string => {
    const result = nonEmptyText(value);
    if (!Number.isFinite(Date.parse(result))) throw new StoryStudioProjectError('INVALID_LIBRARY');
    return result;
};

const nonNegativeInteger = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return value;
};

const WORKFLOW_STAGES = new Set<PersistedStoryStudioWorkflow['stage']>([
    'idle', 'planned', 'drafted', 'validated', 'rejected', 'extracted', 'ready-for-canon-review',
]);

export const parseStoryStudioProjectId = (value: unknown): StoryStudioProjectId => {
    const id = nonEmptyText(value);
    if (id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return id as StoryStudioProjectId;
};

export const storyStudioProjectStorageKey = (projectId: StoryStudioProjectId): string =>
    `${STORY_STUDIO_PROJECT_KEY_PREFIX}${parseStoryStudioProjectId(projectId)}`;

const parseEntry = (value: unknown): StoryStudioProjectLibraryEntry => {
    const input = exactObject(value, [
        'projectId', 'displayName', 'createdAt', 'updatedAt', 'currentChapter',
        'plannedChapterCount', 'workflowStage',
    ]);
    const currentChapter = nonNegativeInteger(input.currentChapter);
    const plannedChapterCount = nonNegativeInteger(input.plannedChapterCount);
    const createdAt = isoDate(input.createdAt);
    const updatedAt = isoDate(input.updatedAt);
    if (plannedChapterCount < 1 || currentChapter > plannedChapterCount
        || Date.parse(updatedAt) < Date.parse(createdAt)
        || typeof input.workflowStage !== 'string'
        || !WORKFLOW_STAGES.has(input.workflowStage as PersistedStoryStudioWorkflow['stage'])) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return {
        projectId: parseStoryStudioProjectId(input.projectId),
        displayName: nonEmptyText(input.displayName),
        createdAt,
        updatedAt,
        currentChapter,
        plannedChapterCount,
        workflowStage: input.workflowStage as PersistedStoryStudioWorkflow['stage'],
    };
};

export const parseStoryStudioProjectLibraryIndex = (value: unknown): StoryStudioProjectLibraryIndexV1 => {
    const input = exactObject(value, ['kind', 'formatVersion', 'activeProjectId', 'entries', 'updatedAt']);
    if (input.kind !== 'story-studio-project-library-index' || input.formatVersion !== 1
        || !Array.isArray(input.entries)) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    const entries = input.entries.map(parseEntry);
    const ids = entries.map(entry => entry.projectId);
    if (new Set(ids).size !== ids.length) throw new StoryStudioProjectError('INVALID_LIBRARY');
    const activeProjectId = input.activeProjectId === undefined
        ? undefined : parseStoryStudioProjectId(input.activeProjectId);
    if (activeProjectId !== undefined && !ids.includes(activeProjectId)) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    if (entries.length === 0 && activeProjectId !== undefined) {
        throw new StoryStudioProjectError('INVALID_LIBRARY');
    }
    return {
        kind: 'story-studio-project-library-index', formatVersion: 1,
        ...(activeProjectId === undefined ? {} : { activeProjectId }),
        entries, updatedAt: isoDate(input.updatedAt),
    };
};

export const createEmptyStoryStudioProjectLibraryIndex = (updatedAt: string): StoryStudioProjectLibraryIndexV1 => ({
    kind: 'story-studio-project-library-index', formatVersion: 1, entries: [], updatedAt: isoDate(updatedAt),
});

const secretSafeCatalogDisplayName = (project: StoryStudioRuntimeProject, displayName: string): string => {
    const normalized = nonEmptyText(displayName);
    return project.control.authorOnlySecrets.some(secret => normalized.includes(secret.value))
        ? 'Dự án Story Studio'
        : normalized;
};

export const deriveStoryStudioProjectLibraryEntry = (
    projectId: StoryStudioProjectId,
    project: StoryStudioRuntimeProject,
): StoryStudioProjectLibraryEntry => ({
    projectId,
    displayName: secretSafeCatalogDisplayName(project, project.displayName),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    currentChapter: project.state.currentChapter,
    plannedChapterCount: project.control.engine.plannedChapterCount,
    workflowStage: project.workflow.stage,
});

export const createBrowserStoryStudioProjectId = (): StoryStudioProjectId => {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') return parseStoryStudioProjectId(cryptoApi.randomUUID());
    if (typeof cryptoApi?.getRandomValues === 'function') {
        const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
        return parseStoryStudioProjectId([
            hex.slice(0, 4).join(''), hex.slice(4, 6).join(''), hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''), hex.slice(10).join(''),
        ].join('-'));
    }
    const entropy = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return parseStoryStudioProjectId(`local-${entropy}`);
};

interface InspectedProject {
    readonly availability: StoryStudioProjectLibraryViewEntry['availability'];
    readonly project?: StoryStudioRuntimeProject;
    readonly workflowRecovered?: boolean;
}

export interface StoryStudioProjectRepositoryResult {
    readonly projectId: StoryStudioProjectId;
    readonly project: StoryStudioRuntimeProject;
    readonly workflowRecovered: boolean;
    readonly library: StoryStudioProjectLibrarySnapshot;
}

/** A single serialized lane orders all project and index mutations. */
export class StoryStudioProjectRepository {
    private writeLane: Promise<void> = Promise.resolve();

    constructor(
        private readonly adapter: StoryStudioStorageAdapter = STORY_STUDIO_INDEXED_DB_ADAPTER,
        private readonly now: () => string = () => new Date().toISOString(),
        private readonly generateProjectId: () => StoryStudioProjectId | string = createBrowserStoryStudioProjectId,
    ) {}

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const operation = this.writeLane.catch(() => undefined).then(work);
        this.writeLane = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private async loadValue(key: string): Promise<unknown | null | undefined> {
        try {
            return await this.adapter.load(key);
        } catch {
            throw new StoryStudioProjectError('LOAD_FAILED');
        }
    }

    private async saveValue(key: string, value: unknown, code: 'SAVE_FAILED' | 'MIGRATION_FAILED'): Promise<void> {
        try {
            await this.adapter.save(key, value);
        } catch {
            throw new StoryStudioProjectError(code);
        }
    }

    private async loadOrMigrateIndex(): Promise<{ index: StoryStudioProjectLibraryIndexV1; workflowRecovered: boolean }> {
        const storedIndex = await this.loadValue(STORY_STUDIO_PROJECT_LIBRARY_KEY);
        if (storedIndex !== null && storedIndex !== undefined) {
            return { index: parseStoryStudioProjectLibraryIndex(storedIndex), workflowRecovered: false };
        }

        const legacyValue = await this.loadValue(STORY_STUDIO_STORAGE_KEY);
        if (legacyValue === null || legacyValue === undefined) {
            const index = createEmptyStoryStudioProjectLibraryIndex(this.now());
            await this.saveValue(STORY_STUDIO_PROJECT_LIBRARY_KEY, index, 'MIGRATION_FAILED');
            return { index, workflowRecovered: false };
        }

        let parsed: ReturnType<typeof parseStoryStudioProjectDocument>;
        try {
            parsed = parseStoryStudioProjectDocument(legacyValue);
        } catch (error) {
            throw error instanceof StoryStudioProjectError ? error : new StoryStudioProjectError('INVALID_PROJECT');
        }
        const projectId = parseStoryStudioProjectId(this.generateProjectId());
        const projectDocument = withoutRuntimeControl(parsed.project);
        const index: StoryStudioProjectLibraryIndexV1 = {
            kind: 'story-studio-project-library-index', formatVersion: 1, activeProjectId: projectId,
            entries: [deriveStoryStudioProjectLibraryEntry(projectId, parsed.project)], updatedAt: this.now(),
        };

        // Required lossless order: validated record, then index, then legacy cleanup.
        await this.saveValue(storyStudioProjectStorageKey(projectId), projectDocument, 'MIGRATION_FAILED');
        await this.saveValue(STORY_STUDIO_PROJECT_LIBRARY_KEY, index, 'MIGRATION_FAILED');
        try {
            await this.adapter.clear(STORY_STUDIO_STORAGE_KEY);
        } catch {
            // The new library is already complete. A retry will prefer it and never duplicate the legacy record.
            throw new StoryStudioProjectError('LEGACY_CLEANUP_FAILED');
        }
        return { index, workflowRecovered: parsed.workflowRecovered };
    }

    private async inspectProject(projectId: StoryStudioProjectId): Promise<InspectedProject> {
        let value: unknown;
        try {
            value = await this.adapter.load(storyStudioProjectStorageKey(projectId));
        } catch {
            return { availability: 'corrupt' };
        }
        if (value === null || value === undefined) return { availability: 'missing' };
        try {
            const parsed = parseStoryStudioProjectDocument(value);
            return { availability: 'available', project: parsed.project, workflowRecovered: parsed.workflowRecovered };
        } catch {
            return { availability: 'corrupt' };
        }
    }

    private async snapshot(index: StoryStudioProjectLibraryIndexV1): Promise<{
        readonly library: StoryStudioProjectLibrarySnapshot;
        readonly inspected: ReadonlyMap<StoryStudioProjectId, InspectedProject>;
    }> {
        const inspected = new Map<StoryStudioProjectId, InspectedProject>();
        const entries: StoryStudioProjectLibraryViewEntry[] = [];
        for (const entry of index.entries) {
            const result = await this.inspectProject(entry.projectId);
            inspected.set(entry.projectId, result);
            entries.push({ ...entry, availability: result.availability });
        }
        return { library: { index, entries }, inspected };
    }

    async load(): Promise<StoryStudioProjectLoadResult> {
        return this.enqueue(async () => {
            try {
                const loaded = await this.loadOrMigrateIndex();
                const { library, inspected } = await this.snapshot(loaded.index);
                const activeProjectId = loaded.index.activeProjectId;
                if (activeProjectId === undefined) return { status: 'empty', library };
                const active = inspected.get(activeProjectId);
                if (!active?.project) {
                    return {
                        status: 'core-corrupt', library,
                        error: new StoryStudioProjectError('PROJECT_UNAVAILABLE'),
                    };
                }
                return (loaded.workflowRecovered || active.workflowRecovered)
                    ? {
                        status: 'workflow-recovered', projectId: activeProjectId, project: active.project,
                        warning: 'WORKFLOW_CORRUPT_OR_STALE', library,
                    }
                    : { status: 'loaded', projectId: activeProjectId, project: active.project, library };
            } catch (error) {
                return {
                    status: 'core-corrupt',
                    error: error instanceof StoryStudioProjectError ? error : new StoryStudioProjectError('LOAD_FAILED'),
                };
            }
        });
    }

    private async requireIndex(): Promise<StoryStudioProjectLibraryIndexV1> {
        const stored = await this.loadValue(STORY_STUDIO_PROJECT_LIBRARY_KEY);
        if (stored === null || stored === undefined) return (await this.loadOrMigrateIndex()).index;
        return parseStoryStudioProjectLibraryIndex(stored);
    }

    private nextUniqueProjectId(index: StoryStudioProjectLibraryIndexV1): StoryStudioProjectId {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const candidate = parseStoryStudioProjectId(this.generateProjectId());
            if (!index.entries.some(entry => entry.projectId === candidate)) return candidate;
        }
        throw new StoryStudioProjectError('SAVE_FAILED');
    }

    private async commit(writes: readonly StoryStudioStorageWrite[], clears: readonly string[] = []): Promise<void> {
        try {
            await this.adapter.commit(writes, clears);
        } catch {
            throw new StoryStudioProjectError('SAVE_FAILED');
        }
    }

    private async resultFor(
        index: StoryStudioProjectLibraryIndexV1,
        projectId: StoryStudioProjectId,
        project: StoryStudioRuntimeProject,
        workflowRecovered = false,
    ): Promise<StoryStudioProjectRepositoryResult> {
        const { library } = await this.snapshot(index);
        const entries = library.entries.map(entry => entry.projectId === projectId
            ? { ...entry, availability: 'available' as const } : entry);
        return { projectId, project, workflowRecovered, library: { index, entries } };
    }

    createProject(project: StoryStudioRuntimeProject): Promise<StoryStudioProjectRepositoryResult> {
        return this.enqueue(async () => {
            const current = await this.requireIndex();
            const projectId = this.nextUniqueProjectId(current);
            const entry = deriveStoryStudioProjectLibraryEntry(projectId, project);
            const index: StoryStudioProjectLibraryIndexV1 = {
                ...current, activeProjectId: projectId, entries: [...current.entries, entry], updatedAt: this.now(),
            };
            await this.commit([
                { key: storyStudioProjectStorageKey(projectId), value: withoutRuntimeControl(project) },
                { key: STORY_STUDIO_PROJECT_LIBRARY_KEY, value: index },
            ]);
            return this.resultFor(index, projectId, project);
        });
    }

    saveProject(projectId: StoryStudioProjectId, project: StoryStudioRuntimeProject): Promise<StoryStudioProjectRepositoryResult> {
        return this.enqueue(async () => {
            const current = await this.requireIndex();
            const existingEntry = current.entries.find(entry => entry.projectId === projectId);
            if (!existingEntry) {
                throw new StoryStudioProjectError('PROJECT_NOT_FOUND');
            }
            const entry = {
                ...deriveStoryStudioProjectLibraryEntry(projectId, project),
                displayName: existingEntry.displayName,
            };
            const index: StoryStudioProjectLibraryIndexV1 = {
                ...current,
                entries: current.entries.map(existing => existing.projectId === projectId ? entry : existing),
                updatedAt: this.now(),
            };
            await this.commit([
                { key: storyStudioProjectStorageKey(projectId), value: withoutRuntimeControl(project) },
                { key: STORY_STUDIO_PROJECT_LIBRARY_KEY, value: index },
            ]);
            return this.resultFor(index, projectId, project);
        });
    }

    switchActiveProject(projectIdValue: StoryStudioProjectId | string): Promise<StoryStudioProjectRepositoryResult> {
        return this.enqueue(async () => {
            const projectId = parseStoryStudioProjectId(projectIdValue);
            const current = await this.requireIndex();
            if (!current.entries.some(entry => entry.projectId === projectId)) {
                throw new StoryStudioProjectError('PROJECT_NOT_FOUND');
            }
            const inspected = await this.inspectProject(projectId);
            if (!inspected.project) throw new StoryStudioProjectError('PROJECT_UNAVAILABLE');
            const index = current.activeProjectId === projectId ? current : {
                ...current, activeProjectId: projectId, updatedAt: this.now(),
            };
            if (index !== current) await this.commit([{ key: STORY_STUDIO_PROJECT_LIBRARY_KEY, value: index }]);
            return this.resultFor(index, projectId, inspected.project, inspected.workflowRecovered);
        });
    }

    renameProject(
        projectIdValue: StoryStudioProjectId | string,
        displayName: string,
        updatedAt: string,
    ): Promise<StoryStudioProjectRepositoryResult> {
        return this.enqueue(async () => {
            const projectId = parseStoryStudioProjectId(projectIdValue);
            const current = await this.requireIndex();
            if (!current.entries.some(entry => entry.projectId === projectId)) {
                throw new StoryStudioProjectError('PROJECT_NOT_FOUND');
            }
            const inspected = await this.inspectProject(projectId);
            if (!inspected.project) throw new StoryStudioProjectError('PROJECT_UNAVAILABLE');
            const normalizedDisplayName = secretSafeCatalogDisplayName(inspected.project, displayName);
            const index: StoryStudioProjectLibraryIndexV1 = {
                ...current,
                entries: current.entries.map(existing => existing.projectId === projectId
                    ? { ...existing, displayName: normalizedDisplayName, updatedAt: isoDate(updatedAt) }
                    : existing),
                updatedAt: this.now(),
            };
            await this.commit([{ key: STORY_STUDIO_PROJECT_LIBRARY_KEY, value: index }]);
            return this.resultFor(index, projectId, inspected.project, inspected.workflowRecovered);
        });
    }

    deleteProject(projectIdValue: StoryStudioProjectId | string): Promise<StoryStudioProjectLoadResult> {
        return this.enqueue(async () => {
            const projectId = parseStoryStudioProjectId(projectIdValue);
            const current = await this.requireIndex();
            if (!current.entries.some(entry => entry.projectId === projectId)) {
                throw new StoryStudioProjectError('PROJECT_NOT_FOUND');
            }
            const remaining = current.entries.filter(entry => entry.projectId !== projectId);
            let activeProjectId = current.activeProjectId === projectId ? undefined : current.activeProjectId;
            let selected: InspectedProject | undefined;
            if (activeProjectId === undefined && remaining.length > 0) {
                const candidates = [...remaining].sort((left, right) => {
                    const timeOrder = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
                    return timeOrder || left.projectId.localeCompare(right.projectId);
                });
                for (const candidate of candidates) {
                    const inspected = await this.inspectProject(candidate.projectId);
                    if (inspected.project) {
                        activeProjectId = candidate.projectId;
                        selected = inspected;
                        break;
                    }
                }
            }
            if (activeProjectId !== undefined && selected === undefined) {
                selected = await this.inspectProject(activeProjectId);
                if (!selected.project) activeProjectId = undefined;
            }
            const index: StoryStudioProjectLibraryIndexV1 = {
                ...current,
                ...(activeProjectId === undefined ? { activeProjectId: undefined } : { activeProjectId }),
                entries: remaining,
                updatedAt: this.now(),
            };
            const normalizedIndex = parseStoryStudioProjectLibraryIndex(index);
            await this.commit(
                [{ key: STORY_STUDIO_PROJECT_LIBRARY_KEY, value: normalizedIndex }],
                [storyStudioProjectStorageKey(projectId)],
            );
            const { library } = await this.snapshot(normalizedIndex);
            if (activeProjectId === undefined || !selected?.project) return { status: 'empty', library };
            return selected.workflowRecovered
                ? {
                    status: 'workflow-recovered', projectId: activeProjectId, project: selected.project,
                    warning: 'WORKFLOW_CORRUPT_OR_STALE', library,
                }
                : { status: 'loaded', projectId: activeProjectId, project: selected.project, library };
        });
    }
}

export class InMemoryStoryStudioStorageAdapter implements StoryStudioStorageAdapter {
    readonly values = new Map<string, unknown>();
    failNextLoad = false;
    failNextSave = false;
    failNextClear = false;
    failNextCommit = false;
    readonly failSaveKeys = new Set<string>();

    async load(key: string): Promise<unknown | null> {
        if (this.failNextLoad) { this.failNextLoad = false; throw new Error('load failed'); }
        const value = this.values.get(key);
        return value === undefined ? null : structuredClone(value);
    }

    async save(key: string, value: unknown): Promise<void> {
        if (this.failNextSave || this.failSaveKeys.delete(key)) {
            this.failNextSave = false;
            throw new Error('save failed');
        }
        this.values.set(key, structuredClone(value));
    }

    async clear(key: string): Promise<void> {
        if (this.failNextClear) { this.failNextClear = false; throw new Error('clear failed'); }
        this.values.delete(key);
    }

    async commit(writes: readonly StoryStudioStorageWrite[], clears: readonly string[] = []): Promise<void> {
        if (this.failNextCommit || this.failNextSave) {
            this.failNextCommit = false;
            this.failNextSave = false;
            throw new Error('commit failed');
        }
        const next = new Map(this.values);
        writes.forEach(write => next.set(write.key, structuredClone(write.value)));
        clears.forEach(key => next.delete(key));
        this.values.clear();
        next.forEach((value, key) => this.values.set(key, value));
    }
}
