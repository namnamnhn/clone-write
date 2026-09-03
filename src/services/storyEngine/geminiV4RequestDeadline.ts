import type { StoryEngineModelRole } from '../../storyEngine/productionRuntimeTypes';

export type GeminiV4CallSurface = 'setupCompiler' | StoryEngineModelRole;

/** App-side safety deadlines, not provider limits. */
export const GEMINI_V4_REQUEST_DEADLINE_MS: Readonly<Record<GeminiV4CallSurface, number>> = {
    setupCompiler: 300_000,
    planner: 180_000,
    writer: 360_000,
    semanticValidator: 180_000,
    repair: 300_000,
    stateExtractor: 180_000,
};

export class GeminiV4RequestTimeoutError extends Error {
    readonly code = 'MODEL_REQUEST_TIMEOUT';

    constructor(readonly surface: GeminiV4CallSurface) {
        super('MODEL_REQUEST_TIMEOUT');
        this.name = 'GeminiV4RequestTimeoutError';
    }
}

export class GeminiV4RequestCancelledError extends Error {
    constructor() {
        super('ABORTED');
        this.name = 'AbortError';
    }
}

export const isGeminiV4RequestTimeoutError = (
    value: unknown,
): value is GeminiV4RequestTimeoutError => value instanceof GeminiV4RequestTimeoutError
    || (value instanceof Error && value.name === 'GeminiV4RequestTimeoutError' && value.message === 'MODEL_REQUEST_TIMEOUT');

export interface RunGeminiV4RequestWithDeadlineOptions<T> {
    readonly surface: GeminiV4CallSurface;
    readonly externalSignal?: AbortSignal;
    readonly operation: (signal: AbortSignal) => Promise<T>;
}

/**
 * Gives each provider attempt its own abort scope and a hard race deadline. A late SDK result stays
 * attached only to the losing race promise and can never resume the caller's completed stage.
 */
export const runGeminiV4RequestWithDeadline = async <T>(
    options: RunGeminiV4RequestWithDeadlineOptions<T>,
): Promise<T> => {
    if (options.externalSignal?.aborted) throw new GeminiV4RequestCancelledError();

    const attemptController = new AbortController();
    const racers: Promise<T>[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeExternalAbortListener: (() => void) | undefined;

    const provider = Promise.resolve().then(() => {
        if (attemptController.signal.aborted) throw new GeminiV4RequestCancelledError();
        return options.operation(attemptController.signal);
    });
    racers.push(provider);

    racers.push(new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new GeminiV4RequestTimeoutError(options.surface));
            attemptController.abort();
        }, GEMINI_V4_REQUEST_DEADLINE_MS[options.surface]);
    }));

    if (options.externalSignal !== undefined) {
        racers.push(new Promise<T>((_resolve, reject) => {
            const onExternalAbort = (): void => {
                reject(new GeminiV4RequestCancelledError());
                attemptController.abort();
            };
            options.externalSignal!.addEventListener('abort', onExternalAbort, { once: true });
            removeExternalAbortListener = () => options.externalSignal!.removeEventListener('abort', onExternalAbort);
            if (options.externalSignal!.aborted) onExternalAbort();
        }));
    }

    try {
        return await Promise.race(racers);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        removeExternalAbortListener?.();
    }
};
