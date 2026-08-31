/**
 * Regenerate rejected CoverProp assets in a controlled, auditable manner.
 *
 * Reads an audit report and re-generates only REJECTED assets, applying
 * adaptive chroma-key strategies and re-running all QC gates.
 *
 * Safety rules:
 *  - Original files are never overwritten (read-only reference)
 *  - Each asset uses a unique directory: <asset_hash>/attempt_<N>/
 *  - Default: approve_after_gate=false (new assets stay in candidates for review)
 *  - max_attempts_per_asset limits provider quota consumption
 *  - replace=false by default; when true, creates timestamped backup first
 *  - Output filename collisions are detected and rejected
 *  - max_provider_requests enforced before each request
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, statSync, unlinkSync, renameSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { ok, err, ErrorCode, artifact } from './result.js';
import { generateImage } from './image_gen.js';
import { saveGeneratedImage } from './utils.js';
import { qcGate, QC_STATUS } from './qc.js';
import { validateOutputPath, validateInputFile } from './path_safety.js';
import { unwrapImages } from './result.js';
import { publishToApproved, archiveToRejected } from './cover_prop.js';

export const REGENERATE_SCHEMA_VERSION = 1;

/**
 * Compute a stable short hash for an asset path (used for unique directories).
 */
function assetHash(assetPath) {
  return createHash('sha256').update(assetPath).digest('hex').slice(0, 12);
}

/**
 * Run controlled regeneration on rejected CoverProp assets.
 *
 * @param {object} args
 * @param {string} args.audit_report_path — path to asset_audit.json
 * @param {string[]} [args.statuses] — which statuses to regenerate (default: ['REJECTED'])
 * @param {string[]} [args.rule_ids] — only regenerate assets failing these rules
 * @param {string[]} [args.asset_paths] — whitelist of specific paths to regenerate
 * @param {string} [args.provider] — AI provider to use
 * @param {number} [args.max_assets] — max assets to process (default: 50)
 * @param {number} [args.max_attempts_per_asset] — max attempts per asset (default: 3)
 * @param {number} [args.max_provider_requests] — total provider request limit
 * @param {string} [args.output_root] — base directory for regeneration candidates
 * @param {boolean} [args.approve_after_gate] — auto-approve if QC passes (default: false)
 * @param {boolean} [args.replace] — allow replacing existing approved assets (default: false)
 * @param {boolean} [args.dry_run] — if true, only report what would be done
 * @param {Function} [args.generator] — optional injection: async (genArgs) => {success, data:{images:[{data,mimeType}]}}. Defaults to generateImage. Used for testing without network.
 * @returns {object} result with regeneration report
 */
export async function regenerateRejectedAssets(args) {
  const {
    audit_report_path,
    statuses = ['REJECTED'],
    rule_ids,
    asset_paths,
    provider,
    max_assets = 50,
    max_attempts_per_asset = 3,
    max_provider_requests,
    output_root = './output/cover_props/regenerations',
    approve_after_gate = false,
    replace = false,
    dry_run = false,
    generator,
  } = args;

  if (!audit_report_path) return err(ErrorCode.INVALID_ARGUMENT, 'audit_report_path is required', { stage: 'validation' });

  const inputCheck = validateInputFile(audit_report_path);
  if (inputCheck?.error) return inputCheck;

  // Load audit report
  let auditReport;
  try {
    const raw = readFileSync(audit_report_path, 'utf8');
    auditReport = JSON.parse(raw);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, `Cannot parse audit report: ${e.message}`, { stage: 'validation' });
  }

  if (!Array.isArray(auditReport.assets)) {
    return err(ErrorCode.PROCESSING_FAILED, 'Audit report missing assets array', { stage: 'validation' });
  }

  // Filter assets to regenerate
  let candidates = auditReport.assets.filter(a => {
    if (!statuses.includes(a.status)) return false;
    if (rule_ids && !a.hard_failures?.some(f => rule_ids.includes(f))) return false;
    if (asset_paths && !asset_paths.includes(a.asset_path)) return false;
    return true;
  }).slice(0, max_assets);

  if (dry_run) {
    return ok({
      dry_run: true,
      total_candidate_assets: candidates.length,
      assets_to_regenerate: candidates.map(a => ({
        path: a.asset_path,
        status: a.status,
        failures: a.hard_failures || [],
        recommended_action: a.recommended_action,
      })),
      estimated_provider_calls: candidates.length * max_attempts_per_asset,
      output_root,
    });
  }

  const sessionId = `regen_${Date.now()}`;
  const regDir = path.join(output_root, sessionId);
  mkdirSync(regDir, { recursive: true });

  // Shared Provider budget — checked atomically BEFORE every real provider call,
  // including within-asset retries. When exhausted, generation is skipped and the
  // asset is marked BUDGET_EXHAUSTED (originals + references untouched).
  const budget = (typeof max_provider_requests === 'number')
    ? { total: max_provider_requests, remaining: max_provider_requests, exhausted: false }
    : null;

  const results = {
    session_id: sessionId,
    total_attempted: 0,
    total_success: 0,
    total_failed: 0,
    total_provider_requests: 0,
    budget_exhausted: false,
    assets: [],
    output_dir: regDir,
  };

  for (const asset of candidates) {
    // Early skip if the shared budget is already exhausted.
    if (budget && budget.remaining <= 0) {
      budget.exhausted = true;
      results.budget_exhausted = true;
      results.assets.push({
        asset_path: asset.asset_path,
        success: false,
        status: 'SKIPPED',
        reason: `Global provider request limit reached (${max_provider_requests})`,
        attempts: [],
      });
      continue;
    }

    results.total_attempted++;
    const assetResult = await regenerateSingleAsset({
      asset,
      provider,
      max_attempts: max_attempts_per_asset,
      output_dir: regDir,
      approve_after_gate,
      replace,
      generator,
      budget,
    });
    results.total_provider_requests += assetResult.provider_requests || 0;
    if (budget) budget.remaining -= assetResult.provider_requests || 0;
    if (assetResult.budget_exhausted) { budget.exhausted = true; results.budget_exhausted = true; }
    results.assets.push(assetResult);
    if (assetResult.success) results.total_success++;
    else results.total_failed++;
  }

  // Write regeneration report
  const reportPath = path.join(regDir, 'regeneration_report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));

  return ok({
    ...results,
    report_path: reportPath,
  }, {
    artifacts: [artifact('json', reportPath)],
  });
}

/**
 * Attempt to regenerate a single rejected asset.
 * Each attempt writes to a unique directory: <asset_hash>/attempt_<N>/
 */
async function regenerateSingleAsset({ asset, provider, max_attempts, output_dir, approve_after_gate, replace, generator, budget }) {
  const { asset_path, hard_failures, regeneration_input = {} } = asset;
  if (!asset_path || !existsSync(asset_path)) {
    return { success: false, status: 'SKIPPED', reason: 'Asset file not found', attempts: [], provider_requests: 0, budget_exhausted: false };
  }

  const aHash = assetHash(asset_path);
  const assetDir = path.join(output_dir, aHash);
  mkdirSync(assetDir, { recursive: true });

  const attempts = [];
  let bestResult = null;
  let providerRequests = 0;
  let budgetExhausted = false;

  const doGenerate = generator || generateImage;

  for (let i = 0; i < max_attempts; i++) {
    // Enforce the SHARED budget before EACH real provider call (mid-asset retries too).
    if (budget && budget.remaining <= 0) {
      budget.exhausted = true;
      budgetExhausted = true;
      attempts.push({ attempt: i + 1, success: false, error: 'BUDGET_EXHAUSTED' });
      break;
    }

    const attemptDir = path.join(assetDir, `attempt_${i + 1}`);
    mkdirSync(attemptDir, { recursive: true });

    // Build generation args from original regeneration_input
    const genArgs = {
      provider,
      prompt: regeneration_input.prompt || 'regenerate sprite',
      width: regeneration_input.width || 1024,
      height: regeneration_input.height || 1024,
      imageUrls: regeneration_input.reference_image_path ? [regeneration_input.reference_image_path] : undefined,
    };

    const gen = await doGenerate(genArgs);
    providerRequests++;
    if (budget) {
      budget.remaining -= 1;
      if (budget.remaining <= 0) budget.exhausted = true;
    }

    if (!gen.success || !unwrapImages(gen)) {
      attempts.push({ attempt: i + 1, success: false, error: gen.error?.message });
      continue;
    }

    const unwrapped = unwrapImages(gen);
    const outPath = path.join(attemptDir, path.basename(asset_path));

    // Check for filename collision
    if (existsSync(outPath)) {
      attempts.push({ attempt: i + 1, success: false, error: `Filename collision: ${outPath}` });
      continue;
    }

    saveGeneratedImage(unwrapped.images[0].data, unwrapped.images[0].mimeType, outPath);

    // Re-run ALL QC gates (not just the failed ones)
    const qc = await qcGate({ image_path: outPath });
    if (!qc.success) {
      attempts.push({ attempt: i + 1, success: false, error: qc.error?.message });
      continue;
    }

    attempts.push({ attempt: i + 1, success: true, qc_status: qc.data.status });

    if (qc.data.status === QC_STATUS.APPROVED) {
      bestResult = { ...qc.data, output_path: outPath, attempt: i + 1 };
      break;
    }
    // For REVIEW_REQUIRED or REJECTED, try next attempt
  }

  if (budget) budgetExhausted = budgetExhausted || budget.exhausted;

  if (bestResult) {
    // Handle approve_after_gate
    let finalStatus = approve_after_gate ? QC_STATUS.APPROVED : QC_STATUS.REVIEW_REQUIRED;
    let approvedDir = null;

    if (approve_after_gate) {
      // Use the CoverProp publish pipeline
      approvedDir = path.join(path.dirname(output_dir), 'approved', path.basename(asset_path, path.extname(asset_path)));
      // publishToApproved returns an error envelope (does NOT throw). On any error
      // the asset must NOT be reported as APPROVED and approved_dir must be null.
      const pub = publishToApproved(
        path.dirname(bestResult.output_path),
        approvedDir,
        path.basename(asset_path, path.extname(asset_path)),
        { replace },
      );
      if (!pub || pub.error) {
        finalStatus = QC_STATUS.REVIEW_REQUIRED;
        approvedDir = null;
      }
    }

    return {
      success: true,
      status: finalStatus,
      qc: bestResult,
      output_path: bestResult.output_path,
      approved_dir: approvedDir,
      attempts,
      provider_requests: providerRequests,
      budget_exhausted: budgetExhausted,
      // Generate comparison report
      comparison: {
        original_path: asset_path,
        new_path: bestResult.output_path,
        original_hash: asset.sha256 || null,
        new_hash: computeFileHash(bestResult.output_path),
      },
    };
  }

  return {
    success: false,
    status: QC_STATUS.REJECTED,
    attempts,
    provider_requests: providerRequests,
    budget_exhausted: budgetExhausted,
    reason: `All ${max_attempts} attempts failed QC`,
  };
}

/**
 * Compute SHA-256 hash of a file.
 */
function computeFileHash(filePath) {
  try {
    const data = readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}
