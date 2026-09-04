import {
  nextCoverPropStage,
  nextCoverPropStageLegacy,
  generateCoverPropPhase1Legacy as generateCoverPropPhase1,
  approveCoverPropLegacy as approveCoverProp,
  processCoverPropPhase2Legacy as processCoverPropPhase2,
} from '../lib/cover_prop_phased.js';
import { buildConceptPrompt, buildConceptRevisionPrompt } from '../lib/cover_prop.js';
import { CAMERA_PRESETS } from '../lib/camera_presets.js';

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
  console.log(`  PASS: ${message}`);
}

// Old linear stage mapping for backward compatibility
assert(nextCoverPropStageLegacy('brief') === 'concept', 'brief advances to concept');
assert(nextCoverPropStageLegacy('concept') === 'view_select', 'concept advances to view_select');
assert(nextCoverPropStageLegacy('view_select') === 'view_generate', 'view_select advances to view_generate');
assert(nextCoverPropStageLegacy('view_generate') === 'view_review', 'view_generate advances to view_review');
assert(nextCoverPropStageLegacy('view_review') === 'state_generate', 'view_review advances to state_generate');
assert(nextCoverPropStageLegacy('state_generate') === 'qc', 'state_generate advances to qc');
assert(nextCoverPropStageLegacy('qc') === 'publish', 'qc advances to publish');
assert(nextCoverPropStageLegacy('publish') === null, 'publish has no successor');
assert(nextCoverPropStageLegacy('unknown') === null, 'unknown stage cannot advance');
assert(Object.keys(CAMERA_PRESETS).length === 7, 'seven named camera presets are available');
const sidePrompt = buildConceptPrompt('concrete barrier', 'masonry', 'low', 'side');
assert(
  sidePrompt.includes('BROAD LONG-FACE ELEVATION') &&
    sidePrompt.includes('top surface') && sidePrompt.includes('No depth perspective'),
  'side-view prompt hard-locks orthographic elevation',
);
const endProfilePrompt = buildConceptPrompt('concrete barrier', 'masonry', 'low', 'end_profile');
assert(
  endProfilePrompt.includes('SHORT-END SIDE PROFILE') &&
    endProfilePrompt.includes('broad long face') && endProfilePrompt.includes('silhouette must be narrow'),
  'end-profile prompt forbids the broad front face',
);
const revisionPrompt = buildConceptRevisionPrompt(
  'concrete barrier', 'masonry', 'low', 'end_profile', 'make the end profile narrower',
);
assert(
  revisionPrompt.includes('authoritative identity and design reference') &&
    revisionPrompt.includes('PRESERVE EXACTLY') &&
    revisionPrompt.includes('APPLY ONLY THIS REVISION') &&
    revisionPrompt.includes('make the end profile narrower'),
  'concept revision prompt preserves identity and isolates feedback',
);

const invalidStart = await generateCoverPropPhase1({
  prop_id: '../escape', prompt: 'test', material_type: 'wood',
});
assert(invalidStart.success === false, 'unsafe prop_id is rejected before generation');

const missingApproval = await approveCoverProp({
  prop_id: 'missing_workflow', candidate_dir: './missing',
});
assert(missingApproval.success === false, 'unknown workflow cannot be approved');

const missingAdvance = await processCoverPropPhase2({
  prop_id: 'missing_workflow', candidate_dir: './missing',
});
assert(missingAdvance.success === false, 'unknown workflow cannot advance');

console.log(`\nPHASED WORKFLOW RESULTS: ${passed}/${passed} passed`);
