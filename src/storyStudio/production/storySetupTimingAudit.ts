import { isCharacterDirectAppearanceAllowed, isPovAllowed } from '../../storyEngine/gates';
import type { GateTimingInput, StoryBlueprint } from '../../storyEngine/compiler';
import type { FullStoryControl } from '../../storyEngine/types';

export const MAX_RECOGNIZED_V3_JSON_OBJECTS = 32;

export interface RecognizedV3CharacterTiming {
    readonly name: string;
    readonly unlockChapter: number;
    readonly directAppearanceChapter: number;
    readonly povUnlockChapter: number;
}

export type SetupTimingAuditIssueCode =
    | 'SOURCE_CHARACTER_TIMING_MISMATCH'
    | 'SOURCE_CHARACTER_GATE_MISSING'
    | 'SOURCE_POV_GATE_MISSING'
    | 'SOURCE_POV_TIMING_MISMATCH'
    | 'SOURCE_CHARACTER_MAPPING_AMBIGUOUS';

export interface SetupTimingAuditIssue {
    readonly code: SetupTimingAuditIssueCode;
    readonly category: 'source-character-timing';
    readonly count: 1;
    readonly expectedChapter?: number;
    readonly actualChapter?: number;
}

export interface ChapterRange {
    readonly startChapter: number;
    readonly endChapter: number;
}

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

const positiveChapter = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** Extract complete JSON objects lexically, then leave all interpretation to JSON.parse. */
const jsonObjectCandidates = (source: string): readonly string[] => {
    const candidates: string[] = [];
    let attempts = 0;
    for (let start = 0; start < source.length && attempts < MAX_RECOGNIZED_V3_JSON_OBJECTS; start += 1) {
        if (source[start] !== '{') continue;
        attempts += 1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') inString = true;
            else if (character === '{') depth += 1;
            else if (character === '}') {
                depth -= 1;
                if (depth === 0) {
                    candidates.push(source.slice(start, index + 1));
                    start = index;
                    break;
                }
            }
        }
    }
    return candidates;
};

const timingFromRegistryEntry = (
    value: unknown,
    registryName?: string,
): RecognizedV3CharacterTiming | undefined => {
    const entry = objectRecord(value);
    if (!entry) return undefined;
    const name = typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : registryName?.trim();
    const unlockChapter = positiveChapter(entry.unlockChapter);
    const directAppearanceChapter = positiveChapter(entry.directAppearanceChapter);
    const povUnlockChapter = positiveChapter(entry.povUnlockChapter);
    if (!name || unlockChapter === undefined || directAppearanceChapter === undefined || povUnlockChapter === undefined) {
        return undefined;
    }
    return { name, unlockChapter, directAppearanceChapter, povUnlockChapter };
};

const timingsFromV3Payload = (value: unknown): readonly RecognizedV3CharacterTiming[] => {
    const payload = objectRecord(value);
    if (!payload) return [];
    const registry = payload.characterRegistry;
    const identifiesV3AuthorSetup = payload.schemaVersion === 3
        && typeof payload.fileKind === 'string'
        && payload.fileKind.trim().toUpperCase().replace(/[\s-]+/g, '_') === 'AUTHOR_SETUP';
    const arrayRegistry = Array.isArray(registry)
        ? registry.map(entry => timingFromRegistryEntry(entry)).filter((entry): entry is RecognizedV3CharacterTiming => entry !== undefined)
        : [];
    const objectRegistry = objectRecord(registry);
    const keyedRegistry = objectRegistry
        ? Object.entries(objectRegistry).map(([name, entry]) => timingFromRegistryEntry(entry, name))
            .filter((entry): entry is RecognizedV3CharacterTiming => entry !== undefined)
        : [];
    const timings = arrayRegistry.length > 0 ? arrayRegistry : keyedRegistry;
    // A complete characterRegistry timing shape is itself a recognized V3 structure; the
    // explicit schemaVersion/fileKind pair additionally recognizes the canonical envelope.
    return identifiesV3AuthorSetup || timings.length > 0 ? timings : [];
};

export const extractRecognizedV3CharacterTimings = (
    source: string,
    maximumSourceBytes: number,
): readonly RecognizedV3CharacterTiming[] => {
    if (new TextEncoder().encode(source).byteLength > maximumSourceBytes) return [];
    const timings: RecognizedV3CharacterTiming[] = [];
    for (const candidate of jsonObjectCandidates(source)) {
        try {
            timings.push(...timingsFromV3Payload(JSON.parse(candidate) as unknown));
        } catch { /* Candidate is not strict JSON; source content is never retained or logged. */ }
    }
    return [...new Map(timings.map(timing => [
        `${timing.name}\u0000${timing.unlockChapter}\u0000${timing.directAppearanceChapter}\u0000${timing.povUnlockChapter}`,
        timing,
    ])).values()];
};

const foldIdentity = (value: string): string => value.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/giu, 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const timingBoundary = (timing: GateTimingInput): number | undefined => {
    const candidates = [
        positiveChapter(timing.allowedFromChapter),
        timing.lockedThroughChapter === undefined ? undefined : positiveChapter(timing.lockedThroughChapter + 1),
    ].filter((chapter): chapter is number => chapter !== undefined);
    return candidates.length === 0 ? undefined : Math.max(...candidates);
};

const characterBaselineBoundary = (character: StoryBlueprint['characters'][number]): number | undefined => {
    const candidates = [
        positiveChapter(character.availableFromChapter),
        timingBoundary(character),
    ].filter((chapter): chapter is number => chapter !== undefined);
    return candidates.length === 0 ? undefined : Math.max(...candidates);
};

const gateBoundary = (gates: readonly GateTimingInput[]): number | undefined => {
    const boundaries = gates.map(timingBoundary).filter((chapter): chapter is number => chapter !== undefined);
    return boundaries.length === 0 ? undefined : Math.max(...boundaries);
};

export const auditRecognizedV3TimingFidelity = (
    timings: readonly RecognizedV3CharacterTiming[],
    blueprint: StoryBlueprint,
    control: FullStoryControl,
): readonly SetupTimingAuditIssue[] => {
    const issues: SetupTimingAuditIssue[] = [];
    const mappedCharacterIds = new Set<string>();
    for (const timing of timings) {
        const issueStart = issues.length;
        const hasCurrentIssue = (code: SetupTimingAuditIssueCode): boolean =>
            issues.slice(issueStart).some(issue => issue.code === code);
        const identity = foldIdentity(timing.name);
        const matches = control.characterOrder.filter((id) => {
            const character = control.characters[id];
            return foldIdentity(id) === identity || foldIdentity(character.name) === identity;
        });
        if (matches.length !== 1 || mappedCharacterIds.has(matches[0])) {
            issues.push({ code: 'SOURCE_CHARACTER_MAPPING_AMBIGUOUS', category: 'source-character-timing', count: 1 });
            continue;
        }
        const characterId = matches[0];
        mappedCharacterIds.add(characterId);
        const blueprintCharacters = blueprint.characters.filter(character => character.id === characterId);
        if (blueprintCharacters.length !== 1
            || characterBaselineBoundary(blueprintCharacters[0]) !== timing.unlockChapter) {
            issues.push({
                code: 'SOURCE_CHARACTER_TIMING_MISMATCH', category: 'source-character-timing', count: 1,
                expectedChapter: timing.unlockChapter,
                ...(blueprintCharacters.length === 1 && characterBaselineBoundary(blueprintCharacters[0]) !== undefined
                    ? { actualChapter: characterBaselineBoundary(blueprintCharacters[0]) } : {}),
            });
        }
        const directGates = blueprint.gates?.characters?.filter(gate => gate.characterId === characterId) ?? [];
        if (directGates.length === 0) {
            issues.push({
                code: 'SOURCE_CHARACTER_GATE_MISSING', category: 'source-character-timing', count: 1,
                expectedChapter: timing.directAppearanceChapter,
            });
        } else if (gateBoundary(directGates) !== timing.directAppearanceChapter) {
            issues.push({
                code: 'SOURCE_CHARACTER_TIMING_MISMATCH', category: 'source-character-timing', count: 1,
                expectedChapter: timing.directAppearanceChapter,
                ...(gateBoundary(directGates) === undefined ? {} : { actualChapter: gateBoundary(directGates) }),
            });
        }
        const povGates = blueprint.gates?.pov?.filter(gate => gate.characterId === characterId) ?? [];
        if (povGates.length === 0) {
            issues.push({
                code: 'SOURCE_POV_GATE_MISSING', category: 'source-character-timing', count: 1,
                expectedChapter: timing.povUnlockChapter,
            });
        } else if (gateBoundary(povGates) !== timing.povUnlockChapter) {
            issues.push({
                code: 'SOURCE_POV_TIMING_MISMATCH', category: 'source-character-timing', count: 1,
                expectedChapter: timing.povUnlockChapter,
                ...(gateBoundary(povGates) === undefined ? {} : { actualChapter: gateBoundary(povGates) }),
            });
        }
        const effectiveDirectChapter = Math.max(timing.unlockChapter, timing.directAppearanceChapter);
        const effectivePovChapter = Math.max(effectiveDirectChapter, timing.povUnlockChapter);
        if (!hasCurrentIssue('SOURCE_CHARACTER_TIMING_MISMATCH')
            && (control.characters[characterId]?.availableFromChapter !== effectiveDirectChapter
            || !isCharacterDirectAppearanceAllowed(control, characterId, effectiveDirectChapter)
            || (effectiveDirectChapter > 1 && isCharacterDirectAppearanceAllowed(control, characterId, effectiveDirectChapter - 1)))) {
            issues.push({
                code: 'SOURCE_CHARACTER_TIMING_MISMATCH', category: 'source-character-timing', count: 1,
                expectedChapter: effectiveDirectChapter,
                ...(control.characters[characterId]?.availableFromChapter === undefined
                    ? {} : { actualChapter: control.characters[characterId].availableFromChapter }),
            });
        }
        if (!hasCurrentIssue('SOURCE_POV_TIMING_MISMATCH')
            && (!isPovAllowed(control, characterId, effectivePovChapter)
            || (effectivePovChapter > 1 && isPovAllowed(control, characterId, effectivePovChapter - 1)))) {
            issues.push({
                code: 'SOURCE_POV_TIMING_MISMATCH', category: 'source-character-timing', count: 1,
                expectedChapter: effectivePovChapter,
            });
        }
    }
    return issues;
};

export const findNoEligiblePovRanges = (control: FullStoryControl): readonly ChapterRange[] => {
    const ranges: ChapterRange[] = [];
    let rangeStart: number | undefined;
    for (let chapter = 1; chapter <= control.engine.plannedChapterCount; chapter += 1) {
        const eligible = control.characterOrder.some(characterId => isPovAllowed(control, characterId, chapter));
        if (!eligible && rangeStart === undefined) rangeStart = chapter;
        if (eligible && rangeStart !== undefined) {
            ranges.push({ startChapter: rangeStart, endChapter: chapter - 1 });
            rangeStart = undefined;
        }
    }
    if (rangeStart !== undefined) {
        ranges.push({ startChapter: rangeStart, endChapter: control.engine.plannedChapterCount });
    }
    return ranges;
};

export const eligiblePovCountAtChapter = (control: FullStoryControl, chapter: number): number =>
    control.characterOrder.filter(characterId => isPovAllowed(control, characterId, chapter)).length;
