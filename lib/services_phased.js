/**
 * Services for phased CoverProp generation.
 * Exports functions that server.js can import.
 */
import {
  generateCoverPropPhase1,
  listPendingReviews,
  approveCoverProp,
  processCoverPropPhase2,
} from './cover_prop_phased.js';

export async function generateCoverPropPhase1Service(args) {
  return generateCoverPropPhase1(args);
}

export async function listPendingReviewsService(args) {
  return listPendingReviews();
}

export async function approveCoverPropService(args) {
  return approveCoverProp(args);
}

export async function processCoverPropPhase2Service(args) {
  return processCoverPropPhase2(args);
}
