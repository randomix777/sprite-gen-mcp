/**
 * Phase-based CoverProp generation service.
 * 
 * Workflow:
 *   Phase 1: Generate image + QC → preview for user review
 *   User approves/rejects
 *   Phase 2: Cutout + post-processing (only on approved)
 */
import { generateCoverProp } from './cover_prop.js';
import { qcGate, QC_STATUS } from './qc.js';
import { saveGeneratedImage } from './utils.js';
import { ok, err, ErrorCode } from './result.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PHASE1_DIR = 'output/phase1_previews';
const PHASE2_DIR = 'output/phase2_approved';
const REVIEW_QUEUE = 'output/review_queue.json';

/**
 * Phase 1: Generate image and run QC, save to preview queue
 */
export async function generateCoverPropPhase1(args) {
  const {
    prop_id,
    prompt,
    material_type,
    cover_height = 'low',
    width = 128,
    height = 128,
    provider = 'agnes',
    output_dir = PHASE1_DIR,
  } = args;

  if (!prop_id || !prompt) {
    return err(ErrorCode.INVALID_ARGUMENT, 'prop_id and prompt are required');
  }

  // Create phase1 directory
  fs.mkdirSync(output_dir, { recursive: true });

  // Generate the asset using existing pipeline
  const genResult = await generateCoverProp({
    prop_id,
    prompt,
    material_type,
    cover_height,
    width,
    height,
    provider,
    output_dir,
    states: ['intact'], // Only generate intact for preview
    style_profile: 'cover_prop', // Use cover_prop style profile for QC thresholds
  });

  if (!genResult.success) {
    return err(ErrorCode.PROCESSING_FAILED, `Generation failed: ${genResult.error?.message}`);
  }

  const manifestPath = path.join(output_dir, 'manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {}

  // Add to review queue
  const queue = loadReviewQueue();
  queue.push({
    prop_id,
    prompt,
    material_type,
    cover_height,
    width,
    height,
    provider,
    generated_at: new Date().toISOString(),
    qc_status: manifest?.qc_status || 'UNKNOWN',
    manifest_path: manifestPath,
    candidates_dir: output_dir,
    approved: false,
  });
  saveReviewQueue(queue);

  return ok({
    prop_id,
    phase: 1,
    status: manifest?.qc_status || 'UNKNOWN',
    manifest_path: manifestPath,
    message: 'Image generated and QC complete. Submit for approval to proceed to Phase 2.',
  });
}

/**
 * Phase 2: Process approved assets (cutout + post-processing)
 */
export async function processCoverPropPhase2(args) {
  const { prop_id, candidate_dir } = args;

  if (!prop_id || !candidate_dir) {
    return err(ErrorCode.INVALID_ARGUMENT, 'prop_id and candidate_dir are required');
  }

  // Validate candidate exists and is approved
  const manifestPath = path.join(candidate_dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.qc_status !== QC_STATUS.APPROVED) {
    return err(ErrorCode.INVALID_ARGUMENT, `Asset not approved: ${manifest.qc_status}. Current: ${manifest.qc_status}`);
  }

  // Move to phase2 directory
  const phase2Dir = path.join(PHASE2_DIR, prop_id);
  fs.mkdirSync(phase2Dir, { recursive: true });

  // Copy approved assets
  const srcIntact = path.join(candidate_dir, `${prop_id}_intact.png`);
  const srcRubble = path.join(candidate_dir, `${prop_id}_rubble.png`);

  if (fs.existsSync(srcIntact)) {
    fs.copyFileSync(srcIntact, path.join(phase2Dir, `${prop_id}_intact.png`));
  }
  if (fs.existsSync(srcRubble)) {
    fs.copyFileSync(srcRubble, path.join(phase2Dir, `${prop_id}_rubble.png`));
  }

  // Run Godot export if project path provided
  if (args.godot_project_path) {
    // Godot scene export logic here
  }

  // Update review queue
  updateQueueStatus(prop_id, { approved: true, phase: 2 });

  return ok({
    prop_id,
    phase: 2,
    status: 'PROCESSED',
    output_dir: phase2Dir,
    message: 'Asset processed and moved to approved directory.',
  });
}

/**
 * List pending reviews
 */
export async function listPendingReviews() {
  const queue = loadReviewQueue();
  const pending = queue.filter(item => !item.approved);
  
  return ok({
    total: pending.length,
    items: pending.map(item => ({
      prop_id: item.prop_id,
      qc_status: item.qc_status,
      generated_at: item.generated_at,
      manifest_path: item.manifest_path,
    })),
  });
}

/**
 * Approve asset for phase 2 processing
 */
export async function approveCoverProp(args) {
  const { prop_id, candidate_dir } = args;
  
  // Mark as approved in queue
  updateQueueStatus(prop_id, { approved: true });
  
  return ok({
    prop_id,
    status: 'APPROVED',
    message: 'Asset approved. Ready for Phase 2 processing.',
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadReviewQueue() {
  try {
    return JSON.parse(fs.readFileSync(REVIEW_QUEUE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveReviewQueue(queue) {
  fs.mkdirSync(path.dirname(REVIEW_QUEUE), { recursive: true });
  fs.writeFileSync(REVIEW_QUEUE, JSON.stringify(queue, null, 2));
}

function updateQueueStatus(prop_id, updates) {
  const queue = loadReviewQueue();
  const idx = queue.findIndex(item => item.prop_id === prop_id);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], ...updates };
    saveReviewQueue(queue);
  }
}
