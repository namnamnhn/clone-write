export interface TriageDelays {
    staggerDelayMs: number;
    recoveryBatchDelayMs: number;
    diagnosisBatchDelayMs: number;
}

export const DEFAULT_TRIAGE_DELAYS: TriageDelays = { staggerDelayMs: 2500, recoveryBatchDelayMs: 3000, diagnosisBatchDelayMs: 2000 };
