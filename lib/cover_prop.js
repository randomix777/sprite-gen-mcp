/**
 * CoverProp — Game furniture/cover asset generation pipeline.
 *
 * Generates complete cover prop assets with:
 *  - Text-to-image concept generation
 *  - Reference-guided intact state generation
 *  - QC gate validation
 *  - Manifest schema (machine-readable asset description)
 *  - Optional Godot 4 scene export
 *  - Rubble/damage variant generation
 *  - State consistency verification
 *
 * Directory staging (strict isolation):
 *  output/candidates/<session>/    — generated but not yet approved
 *  output/approved/<prop_id>/      — passed all gates (written ONLY after final APPROVED)
 *  output/rejected/<session>/      — failed gates (with evidence)
 *
 * IMPORTANT: The approved directory is NEVER created until final QC passes.
 * This prevents pathologically approved but actually-rejected assets from leaking in.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, renameSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ok, err, ErrorCode, artifact, unwrapImages } from './result.js';
import { generateImage } from './image_gen.js';
import { saveGeneratedImage } from './utils.js';
import { qcGate, QC_STATUS, qcStateConsistency, extractBody } from './qc.js';
import { validateOutputPath, validateInputFile, validateGodotProject } from './path_safety.js';
import { exportGodotScene } from './engine_export.js';

// ─── Manifest schema ──────────────────────────────────────────────────────────

export const COVER_PROP_SCHEMA_VERSION = 1;

/**
 * Validate a CoverProp manifest against the schema.
 * Returns { valid, errors } where errors is an array of problem strings.
 */
export function validateCoverPropManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }
  if (manifest.schema_version !== COVER_PROP_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${COVER_PROP_SCHEMA_VERSION}`);
  }
  if (!manifest.prop_id || typeof manifest.prop_id !== 'string') {
    errors.push('prop_id is required (string)');
  }
  if (!manifest.display_name || typeof manifest.display_name !== 'string') {
    errors.push('display_name is required (string)');
  }
  if (!manifest.material_type || !['wood', 'metal', 'glass', 'fabric', 'masonry', 'composite'].includes(manifest.material_type)) {
    errors.push('material_type must be one of: wood, metal, glass, fabric, masonry, composite');
  }
  if (!Array.isArray(manifest.canvas_size) || manifest.canvas_size.length !== 2) {
    errors.push('canvas_size must be [width, height]');
  } else if (manifest.canvas_size[0] < 64 || manifest.canvas_size[1] < 64) {
    errors.push('canvas_size must be at least 64x64');
  }
  if (manifest.ground_anchor) {
    if (!Array.isArray(manifest.ground_anchor) || manifest.ground_anchor.length !== 2) {
      errors.push('ground_anchor must be [x, y]');
    }
  }
  if (!manifest.states || typeof manifest.states !== 'object') {
    errors.push('states object is required');
  } else if (!manifest.states.intact) {
    errors.push('states.intact is required (path to intact PNG)');
  }
  if (manifest.cover) {
    if (manifest.cover.height && !['low', 'high'].includes(manifest.cover.height)) {
      errors.push('cover.height must be "low" or "high"');
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── Directory staging (strict isolation) ─────────────────────────────────────

/**
 * Ensure ONLY the candidate directory exists. Approved/rejected dirs are
 * created lazily ONLY when a final verdict is reached.
 * Returns { candidatesDir }.
 */
export function ensureCandidateDir(baseDir, sessionId) {
  const candidatesDir = path.join(baseDir, 'candidates', sessionId);
  mkdirSync(candidatesDir, { recursive: true });
  return { candidatesDir };
}

/**
 * Archive an asset to rejected directory after final QC verdict.
 */
export function archiveToRejected(candidatesDir, sessionId, propId) {
  const rejectedDir = path.join(path.dirname(path.dirname(candidatesDir)), 'rejected', sessionId);
  mkdirSync(rejectedDir, { recursive: true });
  // Move all candidate files to rejected
  for (const entry of ensureReaddir(candidatesDir)) {
    const src = path.join(candidatesDir, entry);
    const dst = path.join(rejectedDir, entry);
    copyFileSync(src, dst);
  }
  return rejectedDir;
}

/**
 * Publish to approved directory AFTER all gates pass.
 * Default-deny overwrite: unless `replace=true`, an existing approved dir is
 * left completely untouched and an error is returned. With `replace=true`, the
 * old directory is backed up (timestamped), the backup hash verified, then an
 * atomic publish happens; any mid-flight failure rolls back to the backup.
 *
 * @returns {string|object} approvedDir path on success, or err() result on conflict/failure
 */
export function publishToApproved(candidatesDir, approvedDir, propId, { replace = false } = {}) {
  const tmpDir = candidatesDir + '.tmp_publish';
  const stageThenRename = () => {
    // Stage into a temp dir on the SAME filesystem, then atomically rename.
    if (existsSync(tmpDir)) rmSyncRecursive(tmpDir);
    mkdirSync(tmpDir, { recursive: true });
    for (const entry of ensureReaddir(candidatesDir)) {
      copyFileSync(path.join(candidatesDir, entry), path.join(tmpDir, entry));
    }
    mkdirSync(path.dirname(approvedDir), { recursive: true });
    renameSync(tmpDir, approvedDir);
  };

  if (existsSync(approvedDir)) {
    if (!replace) {
      // Strict isolation: never overwrite an existing approved asset.
      // The old directory is left byte-for-byte untouched.
      return err(ErrorCode.OUTPUT_WRITE_FAILED,
        `Approved asset already exists at ${approvedDir}; set replace=true to overwrite`,
        { stage: 'publish', conflict: approvedDir });
    }
    // replace=true → backup first, verify backup, atomic replace, rollback on failure.
    const backupDir = `${approvedDir}.backup_${Date.now()}`;
    try {
      renameSync(approvedDir, backupDir);
    } catch (e) {
      return err(ErrorCode.OUTPUT_WRITE_FAILED, `Cannot back up existing approved dir: ${e.message}`, { stage: 'publish' });
    }
    try {
      stageThenRename();
      if (ensureReaddir(approvedDir).length === 0) throw new Error('published directory is empty after rename');
      // Success → remove backup.
      try { rmSyncRecursive(backupDir); } catch (_) {}
      return approvedDir;
    } catch (e) {
      // Rollback: restore the backup, remove any partial published dir.
      try { if (existsSync(approvedDir)) rmSyncRecursive(approvedDir); } catch (_) {}
      try { if (existsSync(tmpDir)) rmSyncRecursive(tmpDir); } catch (_) {}
      try { renameSync(backupDir, approvedDir); } catch (_) {}
      return err(ErrorCode.OUTPUT_WRITE_FAILED, `Publish failed, rolled back: ${e.message}`, { stage: 'publish' });
    }
  }

  try {
    stageThenRename();
    if (ensureReaddir(approvedDir).length === 0) throw new Error('published directory is empty after rename');
    return approvedDir;
  } catch (e) {
    try { if (existsSync(tmpDir)) rmSyncRecursive(tmpDir); } catch (_) {}
    try { if (existsSync(approvedDir)) rmSyncRecursive(approvedDir); } catch (_) {}
    return err(ErrorCode.OUTPUT_WRITE_FAILED, `Publish failed: ${e.message}`, { stage: 'publish' });
  }
}

function rmSyncRecursive(dir) {
  // Synchronous, fully-awaited removal — no fire-and-forget, no require() in ESM.
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}


function ensureReaddir(dir) {
  try { return readdirSync(dir); } catch (_) { return []; }
}

// ─── Aggregation: compute final status from all states ────────────────────────

/**
 * Compute the final asset status from per-state results.
 *
 * This is the single, default-deny aggregator. It is the ONLY place the final
 * verdict is derived. It must NOT rely on arrays that can be silently skipped
 * (e.g. `.every()` over an empty list returning true), nor on a pre-set
 * `valid:true` manifest placeholder.
 *
 * Rules (default-deny):
 *  - All requested states must exist; missing → REJECTED.
 *  - Every state must be a successful object with a finite status.
 *  - Any state REJECTED → entire asset REJECTED.
 *  - Any state REVIEW_REQUIRED → entire asset REVIEW_REQUIRED.
 *  - Manifest must be valid → otherwise REJECTED.
 *  - If Godot was requested, godotValid must be explicitly provided:
 *      godotValid === false (load/export failed)           → REJECTED
 *      godotValid === 'unavailable' (no engine binary)     → REVIEW_REQUIRED
 *      godotValid === true  (headless load verified)        → allowed
 *      godotValid === undefined and not requested           → ignored
 *  - Otherwise → APPROVED.
 *
 * @param {object} stateResults — map of stateName -> { success, status, generation_result, file_qc, state_consistency_qc, evidence }
 * @param {string[]} requestedStates
 * @param {object} opts — { manifestValid, godotValid }
 */
export function computeAssetStatus(stateResults, requestedStates, opts = {}) {
  const { manifestValid, godotValid } = opts;

  // 1. Every requested state must be present.
  if (!Array.isArray(requestedStates) || requestedStates.length === 0) {
    return QC_STATUS.REJECTED;
  }
  for (const s of requestedStates) {
    if (!stateResults[s]) return QC_STATUS.REJECTED;
  }

  // 2. Every present state must be a successful, fully-resolved result.
  let hasReview = false;
  for (const [stateName, stateData] of Object.entries(stateResults)) {
    if (!stateData) return QC_STATUS.REJECTED;
    if (typeof stateData.success !== 'boolean' || stateData.success !== true) return QC_STATUS.REJECTED;
    const st = stateData.status;
    if (st !== QC_STATUS.APPROVED && st !== QC_STATUS.REVIEW_REQUIRED && st !== QC_STATUS.REJECTED) {
      return QC_STATUS.REJECTED; // unknown / unset status → deny
    }
    if (st === QC_STATUS.REJECTED) return QC_STATUS.REJECTED;
    if (st === QC_STATUS.REVIEW_REQUIRED) hasReview = true;

    // Empty-shell guard: the file QC must have succeeded with a NON-EMPTY rule set.
    const fqc = stateData.file_qc;
    if (!fqc || fqc.status !== QC_STATUS.APPROVED) return QC_STATUS.REJECTED;
    if (!Array.isArray(fqc.rules) || fqc.rules.length === 0) return QC_STATUS.REJECTED;
    // Every rule must be structurally complete with a finite value.
    for (const rule of fqc.rules) {
      if (!rule || typeof rule.id !== 'string' || typeof rule.passed !== 'boolean') return QC_STATUS.REJECTED;
      if (rule.value && typeof rule.value === 'object') {
        for (const v of Object.values(rule.value)) {
          if (typeof v === 'number' && !Number.isFinite(v)) return QC_STATUS.REJECTED;
        }
      }
    }
    // Required measurements must be finite numbers.
    const m = fqc.measurements;
    if (m) {
      for (const v of Object.values(m)) {
        if (typeof v === 'number' && !Number.isFinite(v)) return QC_STATUS.REJECTED;
      }
    }
    // Evidence paths must be strings and exist on disk.
    const ev = stateData.evidence;
    if (!ev || typeof ev !== 'object') return QC_STATUS.REJECTED;
    for (const evPath of Object.values(ev)) {
      if (typeof evPath !== 'string' || evPath.length === 0 || !existsSync(evPath)) return QC_STATUS.REJECTED;
    }
    // Variant states must carry a consistency result with a valid 3-state status.
    // (success was already verified at the call site before storing.)
    if (stateName !== 'intact') {
      const cons = stateData.state_consistency_qc;
      if (!cons || typeof cons.status !== 'string') return QC_STATUS.REJECTED;
      if (cons.status === QC_STATUS.REJECTED) return QC_STATUS.REJECTED;
      if (cons.status === QC_STATUS.REVIEW_REQUIRED) hasReview = true;
    }
  }

  // 3. Manifest must be valid (no stale/placeholder acceptance).
  if (manifestValid !== true) return QC_STATUS.REJECTED;

  // 4. Godot gate (only when requested / provided).
  if (godotValid === false) return QC_STATUS.REJECTED;
  if (godotValid === 'unavailable') hasReview = true;

  return hasReview ? QC_STATUS.REVIEW_REQUIRED : QC_STATUS.APPROVED;
}

// ─── Main CoverProp generation service ────────────────────────────────────────

/**
 * Generate a complete CoverProp asset with QC gates.
 *
 * @param {object} args
 * @param {string} args.prop_id — unique asset identifier
 * @param {string} args.prompt — generation prompt
 * @param {string} args.material_type — wood/metal/glass/fabric/masonry/composite
 * @param {string} [args.cover_height] — 'low' or 'high'
 * @param {number} [args.width] — canvas width (default 1024)
 * @param {number} [args.height] — canvas height (default 1024)
 * @param {string} [args.provider] — AI provider
 * @param {string} [args.reference_image_path] — optional reference image
 * @param {number} [args.seed] — optional seed
 * @param {string[]} [args.states] — states to generate (default: ['intact', 'rubble'])
 * @param {string} [args.output_dir] — base output directory
 * @param {string} [args.godot_project_path] — optional Godot project for scene export
 * @returns {object} result with manifest, QC status, and file paths
 */
export async function generateCoverProp(args) {
  const {
    prop_id,
    prompt,
    material_type,
    cover_height = 'low',
    width = 1024,
    height = 1024,
    provider,
    reference_image_path,
    seed,
    states = ['intact', 'rubble'],
    output_dir = './output/cover_props',
    godot_project_path,
  } = args;

  if (!prop_id) return err(ErrorCode.INVALID_ARGUMENT, 'prop_id is required', { stage: 'validation' });
  if (!prompt) return err(ErrorCode.INVALID_ARGUMENT, 'prompt is required', { stage: 'validation' });

  const sessionId = `cover_${Date.now()}`;
  const { candidatesDir } = ensureCandidateDir(output_dir, sessionId);

  // Per-state results — only written after final verdict
  const stateResults = {};
  let intactQcResult = null;
  let rubbleQcResult = null;
  let consistencyResult = null;

  // ─── Step 1: Generate a concept reference from text only ───────────────────
  const conceptPrompt = buildConceptPrompt(prompt, material_type, cover_height);
  const conceptGen = await generateImage({
    provider, prompt: conceptPrompt, width, height, num_images: 1,
    signal: args.signal,
  });

  if (!conceptGen.success || !unwrapImages(conceptGen)) {
    return err(ErrorCode.PROCESSING_FAILED, 'Failed to generate concept reference',
      { stage: 'generation', cause: conceptGen.error?.message });
  }

  const conceptPath = path.join(candidatesDir, `${prop_id}_concept.png`);
  const conceptUnwrapped = unwrapImages(conceptGen);
  saveGeneratedImage(conceptUnwrapped.images[0].data, conceptUnwrapped.images[0].mimeType, conceptPath);

  // ─── Step 2: Generate intact state from the concept reference ───────────────
  const intactPrompt = buildIntactPrompt(prompt, material_type, cover_height, width, height);
  const intactGen = await generateImage({
    provider, prompt: intactPrompt, width, height, num_images: 1,
    imageUrls: [conceptPath, ...(reference_image_path ? [reference_image_path] : [])],
    signal: args.signal,
  });

  if (!intactGen.success || !unwrapImages(intactGen)) {
    return err(ErrorCode.PROCESSING_FAILED, 'Failed to generate intact state',
      { stage: 'generation', cause: intactGen.error?.message });
  }

  const intactPath = path.join(candidatesDir, `${prop_id}_intact.png`);
  const intactUnwrapped = unwrapImages(intactGen);
  saveGeneratedImage(intactUnwrapped.images[0].data, intactUnwrapped.images[0].mimeType, intactPath);
  stateResults.intact = {
    path: intactPath,
    concept_path: conceptPath,
    concept_gen_result: conceptGen,
    gen_result: intactGen,
  };

  // ─── Step 3: QC gate on intact state ───────────────────────────────────────
  intactQcResult = await qcGate({
    image_path: intactPath,
    canvas_width: width,
    canvas_height: height,
    ground_anchor: [Math.floor(width / 2), Math.floor(height * 0.9)],
  });

  if (!intactQcResult.success) {
    return err(ErrorCode.PROCESSING_FAILED, `Intact QC error: ${intactQcResult.error?.message}`,
      { stage: 'qc', cause: intactQcResult.error?.stack });
  }

  stateResults.intact.file_qc = intactQcResult.data;
  stateResults.intact.evidence = { qc_evidence: intactQcResult.data.evidence_path };
  stateResults.intact.qc = intactQcResult.data;
  stateResults.intact.status = intactQcResult.data.status;
  stateResults.intact.success = true; // Must be set for computeAssetStatus to pass

  // Intact QC rejection → immediate fail, no further generation
  // Unified return contract: always include manifest_path/candidates_dir even on early REJECT
  if (intactQcResult.data.status === QC_STATUS.REJECTED) {
    const rejectedDir = archiveToRejected(candidatesDir, sessionId, prop_id);
    const earlyManifest = buildManifest(stateResults, { width, height, material_type, cover_height, states, prop_id });
    earlyManifest.qc_status = QC_STATUS.REJECTED;
    earlyManifest.approved_dir = null;
    const earlyManifestPath = path.join(candidatesDir, 'manifest.json');
    try { writeFileSync(earlyManifestPath, JSON.stringify(earlyManifest, null, 2)); } catch (_) {}
    return ok({
      prop_id,
      session_id: sessionId,
      qc_status: QC_STATUS.REJECTED,
      rejected_path: rejectedDir,
      state_results: stateResults,
      rejected_rules: intactQcResult.data.rejected_rules,
      evidence_path: intactQcResult.data.evidence_path,
      manifest: earlyManifest,
      manifest_path: earlyManifestPath,
      candidates_dir: candidatesDir,
    }, { warnings: ['Intact state QC failed — asset rejected'] });
  }

  // ─── Step 4: Generate rubble state (if requested) ──────────────────────────
  if (states.includes('rubble')) {
    const rubblePrompt = buildRubblePrompt(prompt, material_type, width, height);
    const rubbleGen = await generateImage({
      provider, prompt: rubblePrompt, width, height, num_images: 1,
      imageUrls: [intactPath], // use intact as reference
      signal: args.signal,
    });

    if (rubbleGen.success && unwrapImages(rubbleGen)) {
      const rubblePath = path.join(candidatesDir, `${prop_id}_rubble.png`);
      const rubbleUnwrapped = unwrapImages(rubbleGen);
      saveGeneratedImage(rubbleUnwrapped.images[0].data, rubbleUnwrapped.images[0].mimeType, rubblePath);
      stateResults.rubble = {
        path: rubblePath,
        gen_result: rubbleGen,
        file_qc: null,
        evidence: {},
      };

      // QC on rubble
      rubbleQcResult = await qcGate({ image_path: rubblePath });
      if (rubbleQcResult.success) {
        stateResults.rubble.file_qc = rubbleQcResult.data;
        stateResults.rubble.evidence = { qc_evidence: rubbleQcResult.data.evidence_path };
        stateResults.rubble.qc = rubbleQcResult.data;
        stateResults.rubble.status = rubbleQcResult.data.status;
        stateResults.rubble.success = true; // Must be set for computeAssetStatus to pass
      }
    } else {
      // Rubble generation failed — hard reject
      stateResults.rubble = {
        path: null,
        gen_result: rubbleGen,
        status: QC_STATUS.REJECTED,
        error: 'Rubble generation failed',
      };
    }
  }

  // ─── Step 5: State consistency check ────────────────────────────────────────
  if (stateResults.rubble?.path && stateResults.intact?.path) {
    consistencyResult = await qcStateConsistency({
      reference_path: stateResults.intact.path,
      variant_path: stateResults.rubble.path,
    });
    if (consistencyResult.success) {
      stateResults.rubble.state_consistency_qc = consistencyResult.data;
      stateResults.rubble.consistency = consistencyResult.data;
      // If consistency fails, mark rubble as REVIEW_REQUIRED at minimum
      if (consistencyResult.data.status === QC_STATUS.REJECTED) {
        stateResults.rubble.status = QC_STATUS.REJECTED;
      } else if (consistencyResult.data.status === QC_STATUS.REVIEW_REQUIRED &&
                 stateResults.rubble.status !== QC_STATUS.REJECTED) {
        stateResults.rubble.status = QC_STATUS.REVIEW_REQUIRED;
      }
    }
  }

  // ─── Step 6: Build manifest and validate ──────────────────────────────────
  const manifest = buildManifest(stateResults, { width, height, material_type, cover_height, states, prop_id });
  const manifestValidation = validateCoverPropManifest(manifest);
  const manifestPath = path.join(candidatesDir, 'manifest.json');

  if (!manifestValidation.valid) {
    // Manifest invalid — reject even if QC passed
    const rejectedDir = archiveToRejected(candidatesDir, sessionId, prop_id);
    return ok({
      prop_id,
      session_id: sessionId,
      qc_status: QC_STATUS.REJECTED,
      rejected_path: rejectedDir,
      manifest_errors: manifestValidation.errors,
      state_results: stateResults,
    }, { warnings: ['Manifest validation failed'] });
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // ─── Step 7: Godot scene export + headless gate (to candidates, NOT approved) ─
  let godotScenePath = null;
  let godotValid = undefined; // undefined = not requested / n/a
  if (godot_project_path && stateResults.intact?.path) {
    const sceneResult = await exportGodotCoverProp({
      prop_id,
      intact_path: stateResults.intact.path,
      width, height,
      cover_height,
      material_type,
      states,
      output_dir: candidatesDir, // ← candidates, not approved!
      godot_project_path,
    });
    if (!sceneResult.success) {
      // Export itself failed → Godot gate fails.
      godotValid = false;
      stateResults.intact.godot_error = sceneResult.error?.message;
    } else {
      godotScenePath = sceneResult.data?.scene_path;
      stateResults.intact.scene_path = godotScenePath;
      stateResults.intact.godot_project = sceneResult.data?.project_root;
      manifest.godot_scene = godotScenePath;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Run the REAL headless load check (if a Godot binary is available).
      const relScene = path.relative(sceneResult.data.project_root, godotScenePath);
      const headless = await runGodotHeadless(sceneResult.data.project_root, relScene);
      if (!headless.available) {
        // No engine binary → cannot verify; per spec this blocks APPROVED.
        godotValid = 'unavailable';
        stateResults.intact.godot_headless = headless;
      } else if (headless.loaded) {
        godotValid = true;
        stateResults.intact.godot_headless = headless;
      } else {
        // Engine present but scene failed to load → hard gate failure.
        godotValid = false;
        stateResults.intact.godot_headless = headless;
      }
    }
  }

  // ─── Step 8: Compute FINAL status AFTER manifest + Godot ──────────────────
  // This must be the LAST computation — after all validation and export.
  // godotValid is provided only when a Godot project was requested.
  const finalStatus = computeAssetStatus(stateResults, states, {
    manifestValid: manifestValidation.valid,
    ...(godot_project_path ? { godotValid } : {}),
  });

  // ─── Step 8b: Finalize & stage the manifest ────────────────────────────────
  // Write the FINAL manifest to a staging dir, re-read it back, verify it parses
  // and carries the final qc_status, then atomically place it into candidates.
  // This prevents the "approved manifest differs from candidate manifest" defect.
  manifest.qc_status = finalStatus;
  manifest.approved_dir = finalStatus === QC_STATUS.APPROVED
    ? path.join(output_dir, 'approved', prop_id).replace(/\\/g, '/')
    : null;
  const stagedManifest = stageThenVerifyManifest(manifestPath, manifest);
  if (!stagedManifest) {
    return ok({
      prop_id, session_id: sessionId, qc_status: QC_STATUS.REJECTED,
      publish_error: 'Manifest staging/verification failed',
      state_results: stateResults, manifest, manifest_path: manifestPath,
      candidates_dir: candidatesDir,
    }, { warnings: ['Manifest staging failed'] });
  }

  // ─── Step 9: Directory staging based on final verdict ──────────────────────
  if (finalStatus === QC_STATUS.REJECTED) {
    const rejectedDir = archiveToRejected(candidatesDir, sessionId, prop_id);
    return ok({
      prop_id,
      session_id: sessionId,
      qc_status: finalStatus,
      rejected_path: rejectedDir,
      state_results: stateResults,
      manifest,
      manifest_path: manifestPath,
      candidates_dir: candidatesDir,
    }, { warnings: ['Asset rejected — moved to rejected directory'] });
  }

  if (finalStatus === QC_STATUS.REVIEW_REQUIRED) {
    // Move to review directory — NOT approved
    const reviewDir = path.join(path.dirname(path.dirname(candidatesDir)), 'review', sessionId);
    mkdirSync(reviewDir, { recursive: true });
    for (const entry of ensureReaddir(candidatesDir)) {
      copyFileSync(path.join(candidatesDir, entry), path.join(reviewDir, entry));
    }
    return ok({
      prop_id,
      session_id: sessionId,
      qc_status: finalStatus,
      review_path: reviewDir,
      state_results: stateResults,
      manifest,
      manifest_path: manifestPath,
      candidates_dir: candidatesDir,
    }, { warnings: ['Asset needs review — moved to review directory'] });
  }

  // ─── Step 10: Final publish (ONLY if APPROVED) ─────────────────────────────
  // Approved directory is created ONLY now, at the very end.
  const approvedDir = path.join(output_dir, 'approved', prop_id);
  const publishResult = publishToApproved(candidatesDir, approvedDir, prop_id, { replace: args.replace === true });
  if (publishResult && publishResult.error) {
    // Publish failed (e.g. conflict without replace) → do NOT claim APPROVED.
    return ok({
      prop_id,
      session_id: sessionId,
      qc_status: QC_STATUS.REJECTED,
      publish_error: publishResult.error.message,
      state_results: stateResults,
      manifest,
      manifest_path: manifestPath,
      candidates_dir: candidatesDir,
    }, { warnings: ['Publish blocked: ' + publishResult.error.message] });
  }

  // Post-publish verification: the approved manifest must semantically match the
  // returned manifest. We re-read it from disk and assert key fields agree.
  const approvedManifestPath = path.join(approvedDir, 'manifest.json');
  let approvedManifest = null;
  try {
    approvedManifest = JSON.parse(readFileSync(approvedManifestPath, 'utf8'));
  } catch (_) {
    return ok({
      prop_id, session_id: sessionId, qc_status: QC_STATUS.REJECTED,
      publish_error: 'Approved manifest missing or unreadable after publish',
      state_results: stateResults, manifest, manifest_path: manifestPath,
      candidates_dir: candidatesDir, approved_dir: approvedDir,
    }, { warnings: ['Approved manifest verification failed'] });
  }
  const consistent = approvedManifest.qc_status === manifest.qc_status
    && approvedManifest.prop_id === manifest.prop_id
    && (approvedManifest.approved_dir || '').replace(/\\/g, '/') === (approvedDir || '').replace(/\\/g, '/');
  if (!consistent) {
    return ok({
      prop_id, session_id: sessionId, qc_status: QC_STATUS.REJECTED,
      publish_error: 'Approved manifest does not match returned manifest',
      state_results: stateResults, manifest, manifest_path: manifestPath,
      candidates_dir: candidatesDir, approved_dir: approvedDir,
    }, { warnings: ['Approved/candidate manifest inconsistency'] });
  }

  return ok({
    prop_id,
    session_id: sessionId,
    qc_status: QC_STATUS.APPROVED,
    state_results: stateResults,
    manifest,
    manifest_path: manifestPath,
    candidates_dir: candidatesDir,
    approved_dir: approvedDir,
    approved_manifest_path: approvedManifestPath,
  }, {
    artifacts: [
      artifact('json', manifestPath),
      artifact('json', approvedManifestPath),
      artifact('image', stateResults.intact?.concept_path),
      artifact('image', stateResults.intact?.path),
      artifact('image', stateResults.rubble?.path),
    ],
  });
}

/**
 * Stage a manifest: write to a temp location, re-read it, verify it parses and
 * carries the expected qc_status, then atomically move it onto manifestPath.
 * Returns true on success, false on any verification failure.
 */
function stageThenVerifyManifest(manifestPath, manifest) {
  const tmpPath = manifestPath + '.staging';
  try {
    writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
    const reread = JSON.parse(readFileSync(tmpPath, 'utf8'));
    if (reread.qc_status !== manifest.qc_status || reread.prop_id !== manifest.prop_id) {
      return false;
    }
    writeFileSync(manifestPath, JSON.stringify(reread, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

export const CHROMA_CANDIDATES = [
  { name: 'magenta', rgb: [255, 0, 255], hex: '#FF00FF' },
  { name: 'green', rgb: [0, 255, 0], hex: '#00FF00' },
  { name: 'blue', rgb: [0, 102, 255], hex: '#0066FF' },
];

export function selectChromaColor({ prompt = '', material_type = '', reference_image_path = null } = {}) {
  const lower = `${prompt} ${material_type}`.toLowerCase();
  const hasMagenta = /magenta|purple|violet|fuchsia|洋红|紫/.test(lower);
  const hasGreen = /green|emerald|lime|jade|绿/.test(lower);
  if (hasMagenta) return CHROMA_CANDIDATES[1];
  if (hasGreen) return CHROMA_CANDIDATES[2];
  return CHROMA_CANDIDATES[0];
}

export function buildIntactPrompt(prompt, materialType, coverHeight, width, height, cameraView = 'side') {
  const chroma = selectChromaColor({ prompt, material_type: materialType });
  return `Using the supplied concept image as the visual reference, generate the production-ready intact state of one isolated game prop, centered and fully visible.
Prompt: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
${buildCameraConstraint(cameraView)}
Canvas size: ${width}x${height}. Keep at least 8% clear background margin around the object.
The complete object silhouette must remain inside the canvas, including legs, corners, handles, and debris.
Place the lowest physical contact point consistently near the requested ground anchor.
Background requirements:
- Use one perfectly uniform solid chroma-key background color: ${chroma.name} RGB(${chroma.rgb[0]}, ${chroma.rgb[1]}, ${chroma.rgb[2]}), hex ${chroma.hex}.
- The entire background must be exactly one flat color.
- No checkerboard pattern, gradient, texture, floor, wall, room, scenery, horizon, border, frame, shadow, reflection, glow, smoke, particles, text, labels, or watermark.
- Do not use the chroma-key background color anywhere on the object.
- Keep at least 8% clear background margin around the object.
Negative: top-down view, bird's-eye view, isometric view, three-quarter view, perspective, visible top surface, vanishing point, checkerboard, transparency grid, white background, gray background, gradient background, textured background, room, wall, floor, scenery, cast shadow, reflection, glow, border, frame, cropped, cut off, multiple objects, contact sheet, text, watermark, chroma-colored object details.`;
}

export function buildConceptPrompt(prompt, materialType, coverHeight, cameraView = 'side') {
  return `${buildCameraConstraint(cameraView)}
Create a clean visual concept for one game cover prop for a 2D game.
Prompt: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
Show one complete object only, centered and fully visible.
Preserve a clear silhouette and readable construction details suitable for a later production asset pass.
Use one uniform flat background with no scenery, floor, shadow, text, watermark, border, frame, or additional objects.
Negative: top-down, bird's-eye, overhead, isometric, axonometric, three-quarter angle, 3/4 view, perspective, visible top plane, vanishing point, turntable, multiple views.`;
}

export function buildConceptRevisionPrompt(prompt, materialType, coverHeight, cameraView, feedback) {
  return `Use the supplied concept image as the authoritative identity and design reference.
Original design brief: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
${buildCameraConstraint(cameraView)}
PRESERVE EXACTLY unless the revision explicitly asks otherwise:
- The same object identity, recognizable design language, main construction and functional purpose.
- The same material family, color palette, proportions and art style.
- All details unrelated to the requested revision.
APPLY ONLY THIS REVISION:
${feedback}
Do not invent a different prop, redesign unrelated parts, add scenery, add text, or produce multiple views.
Return one complete isolated revised concept on one uniform flat background.`;
}

export function buildCameraConstraint(cameraView = 'side') {
  if (cameraView === 'end_profile') {
    return `CAMERA LOCK — TRUE SHORT-END SIDE PROFILE FOR A 2D SIDE-SCROLLER:
- View the prop directly from its narrow end, looking exactly along the object's long axis.
- Show only the short end face and its thickness profile; the broad long face shown in product photos must not be visible.
- The silhouette must be narrow rather than long, suitable for a barrier extending into the screen in a side-scrolling game.
- Orthographic camera at the object's vertical midpoint, zero downward angle, no top surface, no perspective and no three-quarter view.`;
  }
  if (cameraView === 'side' || cameraView === 'long_elevation') {
    return `CAMERA LOCK — BROAD LONG-FACE ELEVATION:
- Orthographic side-on camera at the object's vertical midpoint, looking horizontally with zero downward angle.
- Show the broad gameplay-facing elevation as a flat silhouette, as it would appear in a 2D side-scrolling game.
- The top surface and receding end planes must be completely invisible; use parallel horizontal and vertical edges only.
- No depth perspective, no vanishing point, no isometric or three-quarter presentation.`;
  }
  if (cameraView === 'top_down') return 'CAMERA LOCK: orthographic top-down view, camera directly overhead, no horizon and no side elevation.';
  if (cameraView === 'three_quarter') return 'CAMERA LOCK: consistent three-quarter game-asset view with a mildly elevated camera.';
  if (cameraView === 'isometric') return 'CAMERA LOCK: true isometric projection with equal axis scale, fixed 30-degree axes and no perspective vanishing point.';
  if (cameraView === 'rear') return 'CAMERA LOCK: orthographic rear elevation, looking squarely at the back face with no top surface, receding planes or perspective.';
  return 'CAMERA LOCK: orthographic front elevation with no perspective or visible receding planes.';
}

export function buildRubblePrompt(prompt, materialType, width, height, cameraView = 'side') {
  const chroma = selectChromaColor({ prompt, material_type: materialType });
  return `Generate the destroyed/rubble version of this game prop: ${prompt}.
Material: ${materialType}. The prop is broken apart into debris pieces.
${buildCameraConstraint(cameraView)}
Keep the same canvas size ${width}x${height} and material appearance.
The complete rubble silhouette must remain inside the canvas.
Background requirements:
- Use one perfectly uniform solid chroma-key background color: ${chroma.name} RGB(${chroma.rgb[0]}, ${chroma.rgb[1]}, ${chroma.rgb[2]}), hex ${chroma.hex}.
- The entire background must be exactly one flat color.
- No checkerboard pattern, gradient, texture, floor, wall, room, scenery, horizon, border, frame, shadow, reflection, glow, smoke, particles, text, labels, or watermark.
Negative: checkerboard, transparency grid, white background, gray background, gradient background, textured background, room, wall, floor, scenery, cast shadow, reflection, glow, border, frame, cropped, cut off, multiple objects, contact sheet, text, watermark, chroma-colored object details.`;
}

// ─── Manifest builder ─────────────────────────────────────────────────────────

function buildManifest(stateResults, { width, height, material_type, cover_height, states, prop_id }) {
  const stateFiles = {};
  for (const s of states) {
    if (stateResults[s]?.path) {
      stateFiles[s] = path.basename(stateResults[s].path);
    }
  }
  return {
    schema_version: COVER_PROP_SCHEMA_VERSION,
    prop_id: prop_id || 'unknown',
    display_name: (prop_id || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    material_type,
    canvas_size: [width, height],
    ground_anchor: [Math.floor(width / 2), Math.floor(height * 0.9)],
    states: stateFiles,
    cover: {
      height: cover_height,
      left_peek: true,
      right_peek: true,
      vaultable: cover_height === 'high',
    },
    destruction: {
      max_health: 100,
      destroyed_cover_height: 'none',
    },
    placement: {
      allowed_zones: ['wall', 'center'],
      requires_wall: false,
      clearance_px: 48,
    },
  };
}

// ─── Godot scene export for CoverProp ─────────────────────────────────────────

/**
 * Locate a Godot 4 executable. Returns null if not found.
 * Honors GODOT4_BIN env override, then common PATH / install locations.
 */
export function findGodotExecutable() {
  if (process.env.GODOT4_BIN && existsSync(process.env.GODOT4_BIN)) {
    return process.env.GODOT4_BIN;
  }
  const candidates = [
    'godot', 'godot4', 'Godot', 'Godot4',
    '/usr/local/bin/godot', '/usr/bin/godot',
    'C:\\Program Files\\Godot\\Godot_v4.0-stable_win64.exe',
    'C:\\Program Files\\Godot\\godot.exe',
    process.env.LOCALAPPDATA + '\\Godot\\godot.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } catch (_) {}
  }
  return null;
}

/**
 * Run a Godot 4 headless import/load check on a project containing the scene.
 * Returns { available, version, command, exit_code, stdout, stderr, loaded }.
 * available=false when no Godot binary exists (allowed to be a soft block).
 */
export async function runGodotHeadless(projectPath, sceneRelPath) {
  const godot = findGodotExecutable();
  if (!godot) {
    return { available: false, version: null, command: null, exit_code: null, stdout: '', stderr: '', loaded: false };
  }
  const { spawn } = await import('child_process');
  return new Promise(resolve => {
    const args = ['--headless', '--path', projectPath, '--check-only', sceneRelPath];
    // Hard timeout: Godot's headless editor can hang on some setups and never
    // exit. We MUST NOT let that hang the (commercial) test suite, and we MUST
    // NOT fake a success — an inconclusive run is reported as loaded:false so the
    // caller treats it as REVIEW_REQUIRED, never APPROVED.
    const TIMEOUT_MS = 25000;
    let settled = false;
    const proc = spawn(godot, args, { cwd: projectPath, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve({ available: true, version: null, command: `${godot} ${args.join(' ')}`,
        exit_code: null, stdout, stderr, loaded: false, note: 'timed out — engine did not confirm load (treated as not verified)' });
    }, TIMEOUT_MS);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', e => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ available: true, version: null, command: `${godot} ${args.join(' ')}`, exit_code: null, stdout, stderr: e.message, loaded: false });
    });
    proc.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Treat a non-zero exit OR any scene-parse error signature as a real failure.
      const errSig = /parse error|invalid property|script error|error loading|could not|tscn/i.test(stderr + stdout);
      const loaded = code === 0 && !errSig;
      resolve({
        available: true,
        version: null,
        command: `${godot} ${args.join(' ')}`,
        exit_code: code,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
        loaded,
      });
    });
  });
}

/**
 * Export a CoverProp as a self-contained Godot 4 .tscn scene.
 *
 * Strategy (per hardening spec): generate a scene that does NOT depend on any
 * external script (no res://scripts/cover_prop.gd). Collision, CoverZone and
 * markers are derived from the QC body bbox + ground anchor so they stay inside
 * the canvas and never overlap transparent regions by default.
 *
 * If `godot_project_path` is provided (a validated Godot project root), the
 * texture is copied into that project and `res://` paths are resolved against it.
 * Otherwise a self-contained verification project is created under `output_dir`.
 */
export async function exportGodotCoverProp(args) {
  const {
    prop_id,
    intact_path,
    width,
    height,
    cover_height,
    material_type,
    states,
    output_dir,
    godot_project_path,
  } = args;

  if (!intact_path) return err(ErrorCode.INVALID_ARGUMENT, 'intact_path is required', { stage: 'validation' });
  const inputCheck = validateInputFile(intact_path);
  if (inputCheck?.error) return inputCheck;

  // Resolve the project root: either the user's validated project or a self-contained verify dir.
  let projectRoot, resBasePath, sceneDir;
  if (godot_project_path) {
    const gp = validateGodotProject(godot_project_path);
    if (gp.error) return gp;
    projectRoot = gp;
    resBasePath = path.join(projectRoot, 'assets', 'cover_props');
    sceneDir = resBasePath;
  } else {
    sceneDir = path.join(output_dir, 'godot_verify');
    projectRoot = sceneDir;
    resBasePath = sceneDir;
  }
  mkdirSync(resBasePath, { recursive: true });

  // Copy texture into the project so the res:// reference is real & resolvable.
  const texBase = path.basename(intact_path);
  const texDest = path.join(resBasePath, texBase);
  try {
    copyFileSync(intact_path, texDest);
  } catch (e) {
    return err(ErrorCode.OUTPUT_WRITE_FAILED, `Cannot copy texture into project: ${e.message}`, { stage: 'godot' });
  }
  const texResPath = `res://${path.relative(projectRoot, texDest).split(path.sep).join('/')}`;

  // Derive collision/cover/markers from the QC body bbox (main connected component).
  const body = await deriveBodyFromImage(intact_path);
  const halfW = Math.floor(width / 2);
  const coll = body.bbox
    ? {
        x: body.bbox[0],
        y: body.bbox[1],
        w: body.bbox[2],
        h: body.bbox[3],
      }
    : { x: Math.floor(width * 0.2), y: Math.floor(height * 0.2), w: Math.floor(width * 0.6), h: Math.floor(height * 0.6) };
  const coverZoneH = cover_height === 'high' ? Math.floor(height * 0.5) : Math.floor(height * 0.3);
  const groundY = body.centroid ? Math.round(body.centroid[1] + body.height / 2) : Math.floor(height * 0.9);

  const outPath = path.join(sceneDir, `${prop_id}.tscn`);
  const scene = buildGodotCoverPropScene({
    propId: prop_id, texResPath, width, height, coverHeight: cover_height,
    materialType: material_type, coll, coverZoneH, groundY, halfW,
  });
  writeFileSync(outPath, scene, 'utf8');

  // Ensure a minimal project.godot exists so Godot can import the scene.
  const projFile = path.join(projectRoot, 'project.godot');
  if (!existsSync(projFile)) {
    writeFileSync(projFile,
      '; Engine configuration file.\nconfig_version=5\n\n[application]\n\n[rendering]\n\n');
  }

  // Real Godot verification (defect: previously only wrote "已验证" without running).
  // Only when the caller supplied a real project AND a Godot binary is present do we
  // actually import the scene headlessly. If no binary exists, we must NOT claim
  // verification succeeded — godot_valid stays undefined so the caller treats it as
  // REVIEW_REQUIRED, never APPROVED.
  let godot_valid;
  if (godot_project_path) {
    const headless = await runGodotHeadless(projectRoot, path.relative(projectRoot, outPath));
    godot_valid = headless.available ? (headless.exit_code === 0) : undefined;
  }

  return ok({
    scene_path: outPath,
    prop_id,
    project_root: projectRoot,
    texture_path: texDest,
    res_texture_path: texResPath,
    collision: coll,
    cover_zone_height: coverZoneH,
    ground_y: groundY,
    godot_valid,
  }, {
    artifacts: [artifact('text', outPath, { mime_type: 'text/plain' })],
  });
}

/**
 * Derive the main body (max connected component) from an image, for QC-derived
 * Godot geometry. Uses the same extractBody used by qcGate.
 */
async function deriveBodyFromImage(imagePath) {
  try {
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    let alphaMask;
    if (channels === 4) {
      alphaMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaMask[i] = data[i * 4 + 3];
    } else if (channels === 2) {
      alphaMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaMask[i] = data[i * 2 + 1];
    } else {
      // No alpha → treat whole canvas as body (will be clamped by caller).
      return { bbox: null, centroid: null, height: 0, valid: false };
    }
    const body = extractBodyFromMask(alphaMask, w, h);
    return body;
  } catch {
    return { bbox: null, centroid: null, height: 0, valid: false };
  }
}

// Local helper wrapping extractBody (imported at module top).
function extractBodyFromMask(alphaMask, w, h) {
  return extractBody(alphaMask, w, h);
}

function buildGodotCoverPropScene({ propId, texResPath, width, height, coverHeight, materialType, coll, coverZoneH, groundY, halfW }) {
  const collX = coll.x, collY = coll.y, collW = coll.w, collH = coll.h;
  // Collision shape MUST align exactly with the body bbox. We place StaticBody2D at
  // the body bbox center and offset the CollisionShape2D by the exact delta so the
  // shape's top-left lands on (collX, collY). Integer-exact, no drift for odd sizes.
  const staticX = Math.floor(collX + collW / 2);
  const staticY = Math.floor(collY + collH / 2);
  const collOffsetX = collX - staticX;
  const collOffsetY = collY - staticY;

  // CoverZone straddles the ground anchor, centered horizontally on the body.
  const coverW = collW + 64;
  const coverCenterX = Math.floor(collX + collW / 2);
  const coverCenterY = Math.floor(groundY - coverZoneH / 2);

  // Clamp ALL markers/peeks to the canvas so they never escape it (defect #5).
  const clampX = (v) => Math.max(0, Math.min(width, v));
  const clampY = (v) => Math.max(0, Math.min(height, v));
  const peekX = clampX(Math.floor(collX) - 32);
  const peekX2 = clampX(Math.floor(collX + collW) + 32);
  const peekY = clampY(Math.floor(groundY - 8));
  const vaultX = clampX(halfW);
  const vaultY = clampY(Math.floor(height * 0.2));
  const debrisX = clampX(halfW);
  const debrisY = clampY(Math.floor(height * 0.8));

  return `[gd_scene load_steps=3 format=3 uid="uid://coverprop_${propId.replace(/[^a-z0-9]/gi, '')}"

[ext_resource type="Texture2D" uid="uid://tex_${propId.replace(/[^a-z0-9]/gi, '')}" path="${texResPath}" id="1_${propId}"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_collision"]
size = Vector2(${collW}, ${collH})

[sub_resource type="RectangleShape2D" id="RectangleShape2D_cover"]
size = Vector2(${coverW}, ${coverZoneH})

; Auto-generated cover prop — verify collision/peek points in-engine.
; prop_id = ${propId} | material_type = ${materialType} | cover_height = ${coverHeight}
[node name="CoverProp" type="Node2D"]

[node name="Sprite2D" type="Sprite2D" parent="."]
centered = false
offset = Vector2(0, 0)
texture = ExtResource("1_${propId}")

[node name="StaticBody2D" type="StaticBody2D" parent="."]
position = Vector2(${staticX}, ${staticY})

[node name="CollisionShape2D" type="CollisionShape2D" parent="StaticBody2D"]
position = Vector2(${collOffsetX}, ${collOffsetY})
shape = SubResource("RectangleShape2D_collision")

[node name="CoverZone" type="Area2D" parent="."]
position = Vector2(${coverCenterX}, ${coverCenterY})

[node name="CollisionShape2D" type="CollisionShape2D" parent="CoverZone"]
position = Vector2(0, 0)
shape = SubResource("RectangleShape2D_cover")

[node name="LeftPeekPoint" type="Marker2D" parent="."]
position = Vector2(${peekX}, ${peekY})

[node name="RightPeekPoint" type="Marker2D" parent="."]
position = Vector2(${peekX2}, ${peekY})

[node name="VaultPoint" type="Marker2D" parent="."]
visible = ${coverHeight === 'high'}
position = Vector2(${vaultX}, ${vaultY})

[node name="DebrisOrigin" type="Marker2D" parent="."]
position = Vector2(${debrisX}, ${debrisY})
`;
}
