import { describe, expect, it } from 'vitest';
import { clampNumberDraft, shouldPreserveNumberDraft, syncNumberInputState } from '../src/components/numberInputLocal';

describe('NumberInputLocal', () => {
    it('preserves an in-progress decimal while the parent prop becomes numerically equal', () => {
        expect(shouldPreserveNumberDraft('6.', 6)).toBe(true);
        expect(syncNumberInputState({ text: '6.', syncedValue: 10 }, 6)).toEqual({ text: '6.', syncedValue: 6 });
    });

    it('replaces the draft when an external prop changes to a different value', () => {
        expect(syncNumberInputState({ text: '6.', syncedValue: 6 }, 8)).toEqual({ text: '8', syncedValue: 8 });
    });

    it('normalizes and clamps the value committed on blur', () => {
        expect(clampNumberDraft('6.')).toBe(6);
        expect(clampNumberDraft('99', 1, 10)).toBe(10);
        expect(clampNumberDraft('-3', 0, 10)).toBe(0);
        expect(clampNumberDraft('', 0, 10)).toBe('');
    });
});
