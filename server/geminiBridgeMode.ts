export const GEMINI_TRANSPORT_MODE_ENV = 'GEMINI_TRANSPORT_MODE';

export type GeminiTransportMode = 'direct' | 'server';

export const resolveGeminiTransportMode = (
    environment: Readonly<Record<string, string | undefined>>,
): GeminiTransportMode => {
    const configured = environment[GEMINI_TRANSPORT_MODE_ENV]?.trim().toLowerCase();
    if (configured === 'direct') return 'direct';
    if (configured === 'server') return 'server';

    // AI Studio exposes GEMINI_API_KEY to its Node runtime. Vite's local .env files
    // are loaded separately and therefore do not trigger this branch.
    return environment.GEMINI_API_KEY ? 'server' : 'direct';
};

