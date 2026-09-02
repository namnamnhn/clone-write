import { canonicalContentIdentity } from './canonicalIdentity';
import type {
    ProductionDraftArtifact,
    ProductionExtractionArtifact,
    ProductionPlanArtifact,
    ProductionStageCursor,
    ProductionValidationArtifact,
} from './productionRuntimeTypes';

const cursor = (value: ProductionStageCursor) => ({
    storyControlId: value.storyControlId,
    baseChapter: value.baseChapter,
    baseRevision: value.baseRevision,
    targetChapter: value.targetChapter,
});

export const createProductionPlanArtifactIdentity = (
    value: Omit<ProductionPlanArtifact, 'kind' | 'artifactIdentity'>,
): string => canonicalContentIdentity('production-plan-artifact-v1', {
    ...cursor(value), writerPlan: value.writerPlan, privileged: value.privileged,
});

export const createProductionDraftArtifactIdentity = (
    value: Omit<ProductionDraftArtifact, 'kind' | 'artifactIdentity'>,
): string => canonicalContentIdentity('production-draft-artifact-v1', {
    ...cursor(value), planArtifactIdentity: value.planArtifactIdentity, draft: value.draft,
});

export const createProductionValidationArtifactIdentity = (
    value: Omit<ProductionValidationArtifact, 'kind' | 'artifactIdentity'>,
): string => canonicalContentIdentity('production-validation-artifact-v1', {
    ...cursor(value), planArtifactIdentity: value.planArtifactIdentity,
    draftArtifactIdentity: value.draftArtifactIdentity, result: value.result,
});

export const createProductionExtractionArtifactIdentity = (
    value: Omit<ProductionExtractionArtifact, 'kind' | 'artifactIdentity'>,
): string => canonicalContentIdentity('production-extraction-artifact-v1', {
    ...cursor(value), validationArtifactIdentity: value.validationArtifactIdentity, result: value.result,
});
