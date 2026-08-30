export type NumberInputValue = number | '';

export interface NumberInputState {
    text: string;
    syncedValue: NumberInputValue;
}

export const toDisplayStr = (value: NumberInputValue): string =>
    value === '' || Number.isNaN(value) ? '' : String(value);

export const shouldPreserveNumberDraft = (text: string, nextValue: NumberInputValue): boolean => {
    if (text === toDisplayStr(nextValue)) return true;
    if ((text === '' || text === '-' || text === '.') && nextValue === '') return true;
    const parsed = Number.parseFloat(text);
    return text !== '' && !Number.isNaN(parsed) && parsed === nextValue;
};

export const syncNumberInputState = (state: NumberInputState, nextValue: NumberInputValue): NumberInputState => {
    if (Object.is(state.syncedValue, nextValue)) return state;
    return {
        text: shouldPreserveNumberDraft(state.text, nextValue) ? state.text : toDisplayStr(nextValue),
        syncedValue: nextValue,
    };
};

export const clampNumberDraft = (raw: string, min?: number, max?: number): NumberInputValue | null => {
    if (raw === '' || raw === '-' || raw === '.') return '';
    let parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) return null;
    if (max !== undefined && parsed > max) parsed = max;
    if (min !== undefined && parsed < min) parsed = min;
    return parsed;
};

