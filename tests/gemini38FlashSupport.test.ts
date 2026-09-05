import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('../src/services/api/gemini', () => ({
    getAiClient: () => ({ models: { generateContent } }),
    SAFETY_SETTINGS: [],
    smartExecution: vi.fn(),
}));

import { MODEL_CONFIGS, TIER_MODELS } from '../src/constants';
import { isSupportedGeminiApiModelId } from '../server/geminiBridge';
import { runApiHealthCheck } from '../src/services/api/healthCheck';
import { getEffectiveModelsForTier } from '../src/services/workflows/translate/modelSelection';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    resolveStoryEngineModelRolePolicy,
} from '../src/services/storyEngine/storyEngineModelPolicy';
import { STORY_SETUP_COMPILER_CANDIDATES } from '../src/services/storyEngine/geminiStorySetupCompiler';
import { sanitizeSafeModelAttemptOutcome } from '../src/storyEngine/modelAttemptDiagnostics';

const MODEL_ID = 'gemini-3.8-flash';
const PREVIOUS_MODEL_ID = 'gemini-3.7-flash';

describe('Gemini 3.8 Flash maintenance support', () => {
    beforeEach(() => {
        generateContent.mockReset();
        generateContent.mockResolvedValue({ text: 'OK' });
    });

    it('publishes 3.8 as the newest catalog Flash without removing 3.7/3.6/3.5', () => {
        const newest = MODEL_CONFIGS.find(model => model.id === MODEL_ID);
        const previous = MODEL_CONFIGS.find(model => model.id === PREVIOUS_MODEL_ID);

        expect(newest).toMatchObject({
            name: 'Gemini 3.8 Flash (Mới nhất)', family: 'flash', rpmLimit: 10, rpdLimit: 500,
        });
        expect(previous?.name).toBe('Gemini 3.7 Flash');
        expect(previous?.name).not.toContain('Mới nhất');
        expect(newest!.priority).toBeLessThan(previous!.priority);
        expect(MODEL_CONFIGS.map(model => model.id)).toEqual(expect.arrayContaining([
            MODEL_ID, PREVIOUS_MODEL_ID, 'gemini-3.6-flash', 'gemini-3.5-flash',
        ]));
    });

    it('places 3.8 immediately ahead of 3.7 in the shared Flash pool and translation routes', () => {
        expect(TIER_MODELS.FLASH_POOL.slice(0, 2)).toEqual([MODEL_ID, PREVIOUS_MODEL_ID]);
        expect(getEffectiveModelsForTier('flash', 'translate').slice(0, 2))
            .toEqual([MODEL_ID, PREVIOUS_MODEL_ID]);
        expect(getEffectiveModelsForTier('normal', 'translate').slice(0, 3))
            .toEqual(['gemini-3.1-pro-preview', MODEL_ID, PREVIOUS_MODEL_ID]);
    });

    it('keeps Gemini 3.1 Pro behavior while placing 3.8 first among Story Engine Flash candidates', () => {
        const policy = resolveStoryEngineModelRolePolicy(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY);
        expect(policy.planner.preferredModelId).toBe('gemini-3.1-pro-preview');
        expect(policy.writer.preferredModelId).toBe('gemini-3.1-pro-preview');
        expect(policy.planner.candidateModelIds.slice(0, 3))
            .toEqual(['gemini-3.1-pro-preview', MODEL_ID, PREVIOUS_MODEL_ID]);
        expect(policy.semanticValidator.preferredModelId).toBe(MODEL_ID);
        expect(policy.repair.candidateModelIds.slice(0, 2)).toEqual([MODEL_ID, PREVIOUS_MODEL_ID]);
        expect(policy.stateExtractor.candidateModelIds.slice(0, 2)).toEqual([MODEL_ID, PREVIOUS_MODEL_ID]);
        expect(STORY_SETUP_COMPILER_CANDIDATES.slice(0, 3))
            .toEqual(['gemini-3.1-pro-preview', MODEL_ID, PREVIOUS_MODEL_ID]);
    });

    it('accepts 3.8 through hosted API model validation and safe Story Engine diagnostics', () => {
        expect(isSupportedGeminiApiModelId(MODEL_ID)).toBe(true);
        expect(sanitizeSafeModelAttemptOutcome({
            modelId: MODEL_ID,
            outcomeKind: 'SERVER_5XX',
            httpStatus: 503,
            apiStatus: 'UNAVAILABLE',
        })).toEqual({
            modelId: MODEL_ID,
            outcomeKind: 'SERVER_5XX',
            httpStatus: 503,
            apiStatus: 'UNAVAILABLE',
        });
    });

    it('uses 3.8 for the Gemini health check when it is the enabled model', async () => {
        const results = await runApiHealthCheck({ enabledModels: [MODEL_ID] });

        expect(generateContent).toHaveBeenCalledOnce();
        expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: MODEL_ID }));
        expect(results[0]).toMatchObject({ name: `Gemini (${MODEL_ID})`, ok: true });
    });
});
