import type { useCoreState } from './useCoreState';
import type { useUIState } from './useUIState';

export type CoreApi = ReturnType<typeof useCoreState>;
export type UIApi = ReturnType<typeof useUIState>;
