/**
 * Services for phased CoverProp generation (v2).
 * Exports functions that server.js can import.
 */
import {
  createCoverPropWorkflow,
  generateConcept,
  reviseConcept,
  restartConcept,
  approveConceptStage,
  selectViewsStage,
  generateViewsBatch,
  generateSingleViewStage,
  approveViewStage,
  rejectViewStage,
  regenerateViewStage,
  generateStateVariantsStage,
  generateAllStatesBatch,
  approveStateStage,
  rejectStateStage,
  performQCStage,
  publishWorkflowStage,
  getCoverPropWorkflow,
  listPendingReviews,
  restorePendingTasksStage,
  nextCoverPropStage
} from './cover_prop_phased.js';

export async function createCoverPropWorkflowService(args) {
  return createCoverPropWorkflow(args);
}

export async function generateConceptService(args) {
  return generateConcept(args);
}

export async function reviseConceptService(args) {
  return reviseConcept(args);
}

export async function restartConceptService(args) {
  return restartConcept(args);
}

export async function approveConceptStageService(args) {
  return approveConceptStage(args);
}

export async function selectViewsStageService(args) {
  return selectViewsStage(args);
}

export async function generateViewsBatchService(args) {
  return generateViewsBatch(args);
}

export async function generateSingleViewStageService(args) {
  return generateSingleViewStage(args);
}

export async function approveViewStageService(args) {
  return approveViewStage(args);
}

export async function rejectViewStageService(args) {
  return rejectViewStage(args);
}

export async function regenerateViewStageService(args) {
  return regenerateViewStage(args);
}

export async function generateStateVariantsStageService(args) {
  return generateStateVariantsStage(args);
}

export async function generateAllStatesBatchService(args) {
  return generateAllStatesBatch(args);
}

export async function approveStateStageService(args) {
  return approveStateStage(args);
}

export async function rejectStateStageService(args) {
  return rejectStateStage(args);
}

export async function performQCStageService(args) {
  return performQCStage(args);
}

export async function publishWorkflowStageService(args) {
  return publishWorkflowStage(args);
}

export async function getCoverPropWorkflowService(args) {
  return getCoverPropWorkflow(args);
}

export async function listPendingReviewsService(args) {
  return listPendingReviews(args);
}

export async function restorePendingTasksStageService(args) {
  return restorePendingTasksStage();
}

export { nextCoverPropStage };
