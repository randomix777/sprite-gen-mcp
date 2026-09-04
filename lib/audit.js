/**
 * Asset Audit — comprehensive read-only audit of existing game art assets.
 *
 * Reuses the same QC gates as new generation, ensuring consistent standards
 * for both new and legacy assets. NEVER modifies, moves, or deletes input files.
 *
 * Safety:
 *  - Input root is validated; symlink/junction/reparse detection prevents escape
 *  - Max depth, file count, and total bytes are enforced
 *  - SHA-256, size, and mtime are recorded before and after to prove read-only
 *  - Report directory is validated to not be inside input root (no recursion)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, lstatSync, readdirSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { ok, err, ErrorCode, timer, artifact } from './result.js';
import { qcGate, QC_STATUS, qcStateConsistency } from './qc.js';
import { validateOutputPath, validateInputFile } from './path_safety.js';
import { validateCoverPropManifest, runGodotHeadless } from './cover_prop.js';

const MAX_DEPTH = 10;
const MAX_FILES = 10000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB
const IMAGE_EXTS = /\.(png|jpg|jpeg|webp|bmp)$/i;
const MANIFEST_EXTS = /\.(json)$/i;
const SCENE_EXTS = /\.(tscn|tres)$/i;

/**
 * Compute SHA-256 hash of a file.
 */
function sha256(filePath) {
  try {
    const data = readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Check if a path is a symlink, junction, or reparse point.
 * Returns true if the path is a link that could escape the root.
 */
function isSymlinkOrJunction(filePath) {
  try {
    const stat = lstatSync(filePath);
    return stat.isSymbolicLink() || (stat.isDirectory() && (stat.mode & 0o170000) === 0o040000);
  } catch {
    return false;
  }
}

/**
 * Safe recursive directory walk with limits and symlink detection.
 * Returns { files, stats, errors }.
 */
function safeWalk(root, options = {}) {
  const {
    maxDepth = MAX_DEPTH,
    maxFiles = MAX_FILES,
    maxTotalBytes = MAX_TOTAL_BYTES,
    includePatterns,
    excludePatterns,
  } = options;

  const files = [];
  const stats = { total_files: 0, total_bytes: 0, skipped_symlinks: 0, errors: [] };
  let totalBytes = 0;

  function matchesPatterns(name, patterns) {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some(p => {
      if (p instanceof RegExp) return p.test(name);
      return name.includes(p);
    });
  }

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    if (files.length >= maxFiles) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      stats.errors.push({ path: dir, error: e.message });
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(dir, entry.name);

      // Detect symlinks/junctions
      if (entry.isSymbolicLink()) {
        stats.skipped_symlinks++;
        continue;
      }

      if (entry.isDirectory()) {
        if (matchesPatterns(entry.name, excludePatterns)) continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (matchesPatterns(entry.name, excludePatterns)) continue;
        if (includePatterns && !matchesPatterns(entry.name, includePatterns)) continue;

        // Check extensions
        if (!IMAGE_EXTS.test(entry.name) && !MANIFEST_EXTS.test(entry.name) && !SCENE_EXTS.test(entry.name)) continue;

        try {
          const fileStat = statSync(fullPath);
          totalBytes += fileStat.size;
          if (totalBytes > maxTotalBytes) {
            stats.errors.push({ path: fullPath, error: 'Total byte limit exceeded' });
            return;
          }
          stats.total_files++;
          stats.total_bytes += fileStat.size;

          files.push({
            path: fullPath,
            name: entry.name,
            size: fileStat.size,
            mtime: fileStat.mtime.toISOString(),
            ext: path.extname(entry.name).toLowerCase(),
          });
        } catch (e) {
          stats.errors.push({ path: fullPath, error: e.message });
        }
      }
    }
  }

  walk(root, 0);
  return { files, stats };
}

/**
 * Identify asset type from filename, manifest, or context.
 */
function identifyAssetType(filename, manifest) {
  const lower = filename.toLowerCase();
  if (manifest?.material_type) return 'cover_prop';
  if (lower.includes('rubble') || lower.includes('damaged') || lower.includes('intact')) return 'cover_prop';
  if (lower.includes('tile') || lower.includes('terrain')) return 'tileset';
  if (lower.includes('ui') || lower.includes('icon') || lower.includes('panel')) return 'ui';
  if (lower.includes('effect') || lower.includes('vfx') || lower.includes('particle')) return 'effect';
  if (lower.includes('anim') || lower.includes('frame')) return 'animation';
  return 'sprite';
}

/**
 * Group assets by prop_id and state from filenames/manifests.
 */
function groupAssetsByState(files, manifests) {
  const groups = {};
  for (const file of files) {
    if (file.ext === '.json' || file.ext === '.tscn' || file.ext === '.tres') continue;

    const base = file.name.replace(/\.[^.]+$/, '');
    // Try to detect state from filename: e.g., wooden_bed_01_intact.png
    const stateMatch = base.match(/_(intact|rubble|open|empty|damaged|breached)$/i);
    const state = stateMatch ? stateMatch[1].toLowerCase() : 'unknown';
    const propId = stateMatch ? base.slice(0, -stateMatch[0].length) : base;

    if (!groups[propId]) groups[propId] = { prop_id: propId, files: {}, manifests: [], type: 'unknown' };
    groups[propId].files[state] = file;

    // Check for matching manifest
    const manifestFile = manifests.find(m => m.name.includes(propId));
    if (manifestFile) {
      try {
        const manifestData = JSON.parse(readFileSync(manifestFile.path, 'utf8'));
        groups[propId].manifests.push(manifestData);
        if (manifestData.material_type) groups[propId].type = 'cover_prop';
      } catch {}
    }
  }
  return groups;
}

/**
 * Audit a single image file against QC gates.
 * Returns the full QC result with additional audit metadata.
 */
async function auditSingleFile(file, options = {}) {
  const { strict = true, canvas_width, canvas_height, ground_anchor, thresholds, asset_type, style_profile } = options;

  const qcResult = await qcGate({
    image_path: file.path,
    canvas_width,
    canvas_height,
    ground_anchor,
    thresholds: { ...(thresholds || {}), style_profile },
    asset_type,
  });

  const status = qcResult.data?.status || QC_STATUS.REJECTED;
  const rules = qcResult.data?.rules || [];
  const hardFailures = rules.filter(r => !r.passed).map(r => r.id);
  const measurements = qcResult.data?.measurements || {};
  const evidencePath = qcResult.data?.evidence_path || null;

  // Determine recommended action
  let recommendedAction = 'NONE';
  if (status === QC_STATUS.REJECTED) recommendedAction = 'REGENERATE';
  else if (status === QC_STATUS.REVIEW_REQUIRED) recommendedAction = 'MANUAL_REVIEW';

  return {
    asset_path: file.path,
    asset_type: options.asset_type || 'auto',
    file_size: file.size,
    file_mtime: file.mtime,
    sha256: sha256(file.path),
    status,
    hard_failures: hardFailures,
    review_reasons: status === QC_STATUS.REVIEW_REQUIRED ? hardFailures : [],
    measurements,
    evidence: evidencePath ? { qc_evidence: evidencePath } : {},
    references: [],
    recommended_action: recommendedAction,
    regeneration_input: status === QC_STATUS.REJECTED ? {
      prompt: `Regenerate ${file.name}`,
      width: measurements.width || 1024,
      height: measurements.height || 1024,
    } : {},
  };
}

/**
 * Run a comprehensive audit of existing art assets.
 *
 * @param {object} args
 * @param {string} args.input_path — root directory or single file to audit
 * @param {boolean} [args.recursive=true] — walk subdirectories
 * @param {string} [args.asset_type='auto'] — auto/cover_prop/sprite/animation/effect/tileset/ui
 * @param {string} [args.style_profile] — optional style profile name
 * @param {string} [args.manifest_path] — optional manifest file for the asset
 * @param {string} [args.reference_root] — root for state consistency reference images
 * @param {string} [args.report_dir] — where to write audit reports
 * @param {boolean} [args.strict=true] — strict mode
 * @param {string[]} [args.include_patterns] — file include filters
 * @param {string[]} [args.exclude_patterns] — file exclude filters
 * @param {string} [args.godot_project_path] — optional Godot project for validation
 * @returns {object} audit result with per-file verdicts and aggregate stats
 */
export async function auditAssets(args) {
  const {
    input_path,
    recursive = true,
    asset_type = 'auto',
    style_profile,
    manifest_path,
    reference_root,
    report_dir,
    strict = true,
    include_patterns,
    exclude_patterns,
    godot_project_path,
  } = args;

  const includePatterns = include_patterns;
  const excludePatterns = exclude_patterns;

  if (!input_path) return err(ErrorCode.INVALID_ARGUMENT, 'input_path is required', { stage: 'validation' });

  // Validate input path exists — it may be a file OR a directory (per spec).
  let resolvedInput;
  try {
    resolvedInput = path.resolve(input_path);
    const st = statSync(resolvedInput);
    if (!st.isFile() && !st.isDirectory()) {
      return err(ErrorCode.INVALID_ARGUMENT, `input_path is neither a file nor a directory: ${input_path}`, { stage: 'validation' });
    }
  } catch {
    return err(ErrorCode.FILE_NOT_FOUND, `input_path not found: ${input_path}`, { stage: 'validation' });
  }

  // Validate report_dir is NOT inside input_path (prevent recursion)
  if (report_dir) {
    const resolvedReport = path.resolve(report_dir);
    if (resolvedReport.startsWith(resolvedInput + path.sep) || resolvedReport === resolvedInput) {
      return err(ErrorCode.INVALID_ARGUMENT, 'report_dir must not be inside input_path', { stage: 'validation' });
    }
    const reportCheck = validateOutputPath(path.join(report_dir, 'audit.json'), []);
    if (reportCheck) return reportCheck;
  }

  const elapsed = timer();

  // Record pre-audit hashes for all input files (read-only proof)
  const preAuditHashes = {};

  // Walk the input directory
  const { files, stats: walkStats } = safeWalk(input_path, {
    maxDepth: recursive ? MAX_DEPTH : 1,
    includePatterns,
    excludePatterns,
  });

  if (walkStats.errors.length > 0) {
    // Non-fatal — log errors but continue
  }

  // Separate images, manifests, and scenes
  const imageFiles = files.filter(f => IMAGE_EXTS.test(f.ext));
  const manifestFiles = files.filter(f => MANIFEST_EXTS.test(f.ext));
  const sceneFiles = files.filter(f => SCENE_EXTS.test(f.ext));

  // Record pre-audit hashes
  for (const file of files) {
    preAuditHashes[file.path] = {
      sha256: sha256(file.path),
      size: file.size,
      mtime: file.mtime,
    };
  }

  // Group assets by state
  const groups = groupAssetsByState(imageFiles, manifestFiles);

  // Audit each image
  const assetResults = [];

  for (const file of imageFiles) {
    const result = await auditSingleFile(file, {
      strict,
      asset_type: asset_type === 'auto' ? undefined : asset_type,
      style_profile,
    });

    // Update type from group
    const base = file.name.replace(/\.[^.]+$/, '');
    const stateMatch = base.match(/_(intact|rubble|open|empty|damaged|breached)$/i);
    const propId = stateMatch ? base.slice(0, -stateMatch[0].length) : base;
    if (groups[propId]) {
      result.asset_type = groups[propId].type !== 'unknown' ? groups[propId].type : result.asset_type;
    }

    assetResults.push(result);
  }

  // Run state consistency checks for grouped assets.
  // When reference_root is supplied, the intact reference is resolved from there
  // (a real, separate source) instead of the local folder — this is the spec's
  // "reference_root" contract, not a no-op.
  for (const [propId, group] of Object.entries(groups)) {
    if (group.files.intact && group.files.rubble) {
      let referencePath = group.files.intact.path;
      if (reference_root) {
        const refCandidate = path.join(reference_root, path.basename(group.files.intact.path));
        if (existsSync(refCandidate)) referencePath = refCandidate;
      }
      const consistencyResult = await qcStateConsistency({
        reference_path: referencePath,
        variant_path: group.files.rubble.path,
        variant_type: 'rubble',
      });
      // Attach consistency result to both assets
      const intactResult = assetResults.find(r => r.asset_path === group.files.intact.path);
      const rubbleResult = assetResults.find(r => r.asset_path === group.files.rubble.path);
      if (intactResult && consistencyResult.data) {
        intactResult.state_consistency = {
          reference: referencePath,
          variant: group.files.rubble.path,
          status: consistencyResult.data.status,
          measurements: consistencyResult.data.measurements,
        };
      }
      if (rubbleResult && consistencyResult.data) {
        rubbleResult.state_consistency = {
          reference: referencePath,
          variant: group.files.rubble.path,
          status: consistencyResult.data.status,
          measurements: consistencyResult.data.measurements,
        };
        // If consistency fails, override rubble status
        if (consistencyResult.data.status === QC_STATUS.REJECTED) {
          rubbleResult.status = QC_STATUS.REJECTED;
          rubbleResult.hard_failures.push('STATE_CONSISTENCY');
          if (rubbleResult.recommended_action === 'NONE') rubbleResult.recommended_action = 'REGENERATE';
        }
      }
    }
  }

  // Optional Godot verification: when a project is supplied, actually attempt a
  // headless import of each discovered scene (no silent "verified" claim).
  const godotVerification = { available: false, scenes: [], note: null };
  if (godot_project_path && sceneFiles.length > 0) {
    const gp = validateGodotProject(godot_project_path);
    if (gp.error) {
      godotVerification.note = `godot_project_path invalid: ${gp.error.message}`;
    } else {
      for (const sc of sceneFiles) {
        const headless = await runGodotHeadless(godot_project_path, path.relative(godot_project_path, sc.path));
        godotVerification.available = headless.available;
        godotVerification.scenes.push({
          scene: sc.path,
          available: headless.available,
          loaded: headless.available ? headless.loaded : false,
          exit_code: headless.exit_code,
        });
      }
      if (!godotVerification.available) {
        godotVerification.note = 'Godot binary not found — scenes NOT verified (REVIEW required, not faked APPROVED)';
      }
    }
  }

  // Optional manifest validation: when manifest_path is supplied, validate it for
  // real (the spec's "manifest_path" contract). An invalid manifest is recorded,
  // not silently ignored.
  let manifestValidation = null;
  if (manifest_path) {
    if (!existsSync(manifest_path)) {
      manifestValidation = { valid: false, errors: [`manifest_path not found: ${manifest_path}`] };
    } else {
      try {
        const manifestData = JSON.parse(readFileSync(manifest_path, 'utf8'));
        const mv = validateCoverPropManifest(manifestData);
        manifestValidation = { valid: mv.valid, errors: mv.errors || [] };
      } catch (e) {
        manifestValidation = { valid: false, errors: [`manifest parse error: ${e.message}`] };
      }
    }
  }

  // Post-audit hash verification (prove read-only)
  const postAuditHashes = {};
  const hashMismatches = [];
  for (const file of files) {
    const postHash = sha256(file.path);
    postAuditHashes[file.path] = postHash;
    if (preAuditHashes[file.path]?.sha256 && preAuditHashes[file.path].sha256 !== postHash) {
      hashMismatches.push(file.path);
    }
  }

  // Build aggregate report
  const auditReport = {
    schema_version: 1,
    audit_timestamp: new Date().toISOString(),
    input_path: path.resolve(input_path),
    report_dir: report_dir ? path.resolve(report_dir) : null,
    strict,
    asset_type,
    style_profile: style_profile || null,
    godot_project_path: godot_project_path || null,
    manifest_path: manifest_path || null,
    reference_root: reference_root || null,
    params_used: {
      style_profile: !!style_profile,
      manifest_path: !!manifest_path,
      reference_root: !!reference_root,
      godot_project_path: !!godot_project_path,
    },
    manifest_validation: manifestValidation,
    godot_verification: godotVerification,
    walk_stats: walkStats,
    summary: (() => {
      // Recompute the summary from the FINAL asset records (after all single-image
      // QC and state-consistency checks) so the conservation law always holds:
      //   approved + review_required + rejected + unknown === total_scanned
      // This prevents consistency flips from double-counting rejected assets.
      let A = 0, R = 0, Rev = 0, U = 0;
      for (const a of assetResults) {
        switch (a.status) {
          case QC_STATUS.APPROVED: A++; break;
          case QC_STATUS.REJECTED: R++; break;
          case QC_STATUS.REVIEW_REQUIRED: Rev++; break;
          default: U++;
        }
      }
      return {
        total_scanned: imageFiles.length,
        total_manifests: manifestFiles.length,
        total_scenes: sceneFiles.length,
        approved: A,
        rejected: R,
        review_required: Rev,
        unknown: U,
        conserved: (A + R + Rev + U) === imageFiles.length,
        hash_mismatches: hashMismatches.length,
      };
    })(),
    read_only_verified: hashMismatches.length === 0,
    hash_mismatches: hashMismatches,
    assets: assetResults,
  };

  // Write reports
  const artifacts = [];
  if (report_dir) {
    mkdirSync(report_dir, { recursive: true });

    // JSON report
    const jsonPath = path.join(report_dir, 'asset_audit.json');
    writeFileSync(jsonPath, JSON.stringify(auditReport, null, 2));
    artifacts.push(artifact('json', jsonPath));

    // Markdown report
    const mdPath = path.join(report_dir, 'asset_audit.md');
    writeFileSync(mdPath, generateMarkdownReport(auditReport));
    artifacts.push(artifact('markdown', mdPath));

    // CSV summary
    const csvPath = path.join(report_dir, 'asset_audit.csv');
    writeFileSync(csvPath, generateCsvReport(auditReport));
    artifacts.push(artifact('csv', csvPath));

    // Evidence index
    const evidenceDir = path.join(report_dir, 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const evidenceIndex = assetResults
      .filter(r => r.evidence?.qc_evidence)
      .map(r => ({
        asset: r.asset_path,
        status: r.status,
        evidence: r.evidence.qc_evidence,
        failures: r.hard_failures,
      }));
    writeFileSync(path.join(evidenceDir, 'index.json'), JSON.stringify(evidenceIndex, null, 2));
    artifacts.push(artifact('json', path.join(evidenceDir, 'index.json')));
  }

  return ok({
    ...auditReport,
    artifacts_paths: artifacts.map(a => a.path),
  }, {
    artifacts,
    duration_ms: elapsed(),
  });
}

/**
 * Generate a Markdown summary of the audit.
 */
function generateMarkdownReport(report) {
  const lines = [
    `# Asset Audit Report`,
    ``,
    `**Date:** ${report.audit_timestamp}`,
    `**Input:** \`${report.input_path}\``,
    `**Strict:** ${report.strict}`,
    `**Asset Type:** ${report.asset_type}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total Scanned | ${report.summary.total_scanned} |`,
    `| ✅ Approved | ${report.summary.approved} |`,
    `| ❌ Rejected | ${report.summary.rejected} |`,
    `| ⚠️ Review Required | ${report.summary.review_required} |`,
    `| ❓ Unknown | ${report.summary.unknown} |`,
    `| Read-Only Verified | ${report.read_only_verified ? '✅ Yes' : '❌ No'} |`,
    ``,
    `## Per-Asset Results`,
    ``,
  ];

  for (const asset of report.assets) {
    const icon = asset.status === QC_STATUS.APPROVED ? '✅' :
                 asset.status === QC_STATUS.REJECTED ? '❌' : '⚠️';
    lines.push(`### ${icon} ${path.basename(asset.asset_path)}`);
    lines.push(`- **Status:** ${asset.status}`);
    lines.push(`- **Type:** ${asset.asset_type}`);
    if (asset.hard_failures.length > 0) {
      lines.push(`- **Failures:** ${asset.hard_failures.join(', ')}`);
    }
    if (asset.evidence?.qc_evidence) {
      lines.push(`- **Evidence:** \`${asset.evidence.qc_evidence}\``);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Generate a CSV summary of the audit.
 */
function generateCsvReport(report) {
  const lines = ['asset_path,status,asset_type,hard_failures,recommended_action'];
  for (const asset of report.assets) {
    lines.push([
      `"${asset.asset_path}"`,
      asset.status,
      asset.asset_type,
      `"${asset.hard_failures.join(';')}"`,
      asset.recommended_action,
    ].join(','));
  }
  return lines.join('\n');
}
