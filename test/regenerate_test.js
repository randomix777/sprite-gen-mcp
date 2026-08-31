/**
 * Test: regenerate.js — real controlled regeneration with an injected generator
 * (no network). Asserts: report parsing, dry_run, unique per-asset dirs, never
 * overwrites originals, replace semantics on approve, and max_attempts honored.
 */
import assert from 'assert';
import sharp from 'sharp';
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { regenerateRejectedAssets } from '../lib/regenerate.js';
import { QC_STATUS } from '../lib/qc.js';
import { emitReport } from './_report.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'test', 'tmp_regen');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0;
function ok(name) { passed++; console.log('  PASS:', name); }
function assertFn(cond, name) { assert(cond, name); ok(name); }

// Injected generator that returns a REAL transparent sprite (so QC can pass).
async function makeSprite(w, h, color, pad) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="${pad}" y="${pad}" width="${w - 2 * pad}" height="${h - 2 * pad}" rx="6" fill="rgb(${color.r},${color.g},${color.b})"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// A generator that always returns a valid transparent sprite.
function goodGenerator() {
  return async () => {
    const buf = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20);
    return { success: true, data: { images: [{ data: buf.toString('base64'), mimeType: 'image/png', format: 'png' }] } };
  };
}
// A generator that always FAILS (so we can test max_attempts).
function failGenerator() {
  return async () => ({ success: false, error: { message: 'provider down' } });
}

async function main() {
  // Build a rejected-asset audit report referencing a real original file.
  const origDir = path.join(TMP, 'orig');
  mkdirSync(origDir, { recursive: true });
  const orig = await makeSprite(128, 128, { r: 10, g: 20, b: 30 }, 5);
  const origPath = path.join(origDir, 'broken_intact.png');
  writeFileSync(origPath, orig);
  const origHash = createHash('sha256').update(origPath).digest('hex');

  const reportPath = path.join(TMP, 'asset_audit.json');
  writeFileSync(reportPath, JSON.stringify({
    assets: [{
      asset_path: origPath,
      status: 'REJECTED',
      hard_failures: ['TRANSPARENCY_RATIO'],
      recommended_action: 'REGENERATE',
      sha256: origHash,
      regeneration_input: { prompt: 'regen a crate', width: 128, height: 128 },
    }],
  }, null, 2));

  // ── 1. dry_run produces plan, writes nothing ──
  const dr = await regenerateRejectedAssets({ audit_report_path: reportPath, dry_run: true, output_root: path.join(TMP, 'out') });
  assertFn(dr.success === true, 'dry_run succeeds');
  assertFn(dr.data.dry_run === true, 'dry_run flag set');
  assertFn(dr.data.total_candidate_assets === 1, 'dry_run found 1 candidate');
  assertFn(!existsSync(path.join(TMP, 'out')), 'dry_run wrote no output dir');

  // ── 2. real regeneration with good generator → APPROVED candidate ──
  const outRoot = path.join(TMP, 'out_real');
  const real = await regenerateRejectedAssets({
    audit_report_path: reportPath,
    output_root: outRoot,
    generator: goodGenerator(),
    approve_after_gate: false,
    max_attempts_per_asset: 3,
  });
  assertFn(real.success === true, 'regeneration succeeds');
  assertFn(real.data.total_attempted === 1, 'attempted 1 asset');
  assertFn(real.data.assets[0].success === true, 'asset regenerated successfully');
  assertFn(real.data.assets[0].status === QC_STATUS.REVIEW_REQUIRED, 'default status REVIEW_REQUIRED (not auto-approved)');
  assertFn(existsSync(real.data.assets[0].output_path), 'regenerated file exists on disk');
  // Original untouched
  assertFn(readFileSync(origPath).equals(orig), 'original file byte-identical (never overwritten)');
  // Unique per-asset dir: <hash>/attempt_1/
  assertFn(real.data.assets[0].output_path.includes(path.join(origHash.slice(0, 12), 'attempt_1')), 'output in unique <hash>/attempt_1 dir');

  // ── 3. failGenerator honors max_attempts_per_asset ──
  const failOut = path.join(TMP, 'out_fail');
  const fail = await regenerateRejectedAssets({
    audit_report_path: reportPath,
    output_root: failOut,
    generator: failGenerator(),
    max_attempts_per_asset: 2,
  });
  assertFn(fail.success === true, 'fail-run returns ok envelope');
  assertFn(fail.data.assets[0].success === false, 'asset not regenerated when generator fails');
  assertFn(fail.data.assets[0].attempts.length === 2, `exactly max_attempts attempts made (got ${fail.data.assets[0].attempts.length})`);
  assertFn(fail.data.assets[0].provider_requests === 2, 'provider_requests == attempts');

  // ── 4. asset_paths whitelist filters ──
  const wl = await regenerateRejectedAssets({
    audit_report_path: reportPath,
    output_root: path.join(TMP, 'out_wl'),
    generator: goodGenerator(),
    asset_paths: ['/does/not/exist.png'],
  });
  assertFn(wl.success === true, 'whitelist run succeeds');
  assertFn(wl.data.total_attempted === 0, 'whitelist excludes non-matching asset');

  // ── 5. missing audit report rejected ──
  const bad = await regenerateRejectedAssets({ audit_report_path: path.join(TMP, 'missing.json') });
  assertFn(bad.success === false, 'missing audit report rejected');

  // ── 6. Provider budget NOT bypassed by in-asset retries (Phase 2 #1) ──
  // max_provider_requests=1 with max_attempts=3 must call the generator exactly ONCE.
  let callCount = 0;
  const countingGen = () => async () => { callCount++; const buf = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20); return { success: true, data: { images: [{ data: buf.toString('base64'), mimeType: 'image/png', format: 'png' }] } }; };
  const budgetOut = path.join(TMP, 'out_budget');
  const budget = await regenerateRejectedAssets({
    audit_report_path: reportPath,
    output_root: budgetOut,
    generator: countingGen(),
    max_attempts_per_asset: 3,
    max_provider_requests: 1,
  });
  assertFn(budget.success === true, 'budget run succeeds');
  assertFn(callCount === 1, `generator called exactly once despite max_attempts=3 (got ${callCount})`);
  assertFn(budget.data.total_provider_requests === 1, `total_provider_requests==1 (got ${budget.data.total_provider_requests})`);
  assertFn(budget.data.budget_exhausted === true, 'budget_exhausted flagged');

  // ── 7. Two assets sharing one budget: total calls never exceed limit ──
  callCount = 0;
  const report2 = path.join(TMP, 'asset_audit_2.json');
  const orig2 = await makeSprite(128, 128, { r: 40, g: 50, b: 60 }, 8);
  const origPath2 = path.join(origDir, 'broken2.png');
  writeFileSync(origPath2, orig2);
  writeFileSync(report2, JSON.stringify({ assets: [
    { asset_path: origPath, status: 'REJECTED', hard_failures: ['X'], recommended_action: 'REGENERATE', regeneration_input: { prompt: 'a', width: 128, height: 128 } },
    { asset_path: origPath2, status: 'REJECTED', hard_failures: ['Y'], recommended_action: 'REGENERATE', regeneration_input: { prompt: 'b', width: 128, height: 128 } },
  ] }, null, 2));
  const shared = await regenerateRejectedAssets({
    audit_report_path: report2,
    output_root: path.join(TMP, 'out_shared'),
    generator: countingGen(),
    max_provider_requests: 1,
  });
  assertFn(callCount <= 1, `shared budget: total generator calls never exceed limit (got ${callCount})`);
  assertFn(shared.data.budget_exhausted === true, 'shared budget exhausted after single call');

  // ── 8. approve_after_gate + replace=false conflict → NOT APPROVED (Phase 2 #2) ──
  // First approve creates the approved dir. Second run (same output_root) with
  // replace=false must hit the publish conflict and stay REVIEW.
  const approveOut = path.join(TMP, 'out_approve');
  const first = await regenerateRejectedAssets({
    audit_report_path: reportPath, output_root: approveOut, generator: goodGenerator(),
    approve_after_gate: true, replace: true, max_attempts_per_asset: 3,
  });
  assertFn(first.data.assets[0].status === QC_STATUS.APPROVED, 'first approve_after_gate publishes APPROVED');
  assertFn(first.data.assets[0].approved_dir && existsSync(first.data.assets[0].approved_dir), 'first run created approved dir');

  // Second run against SAME approved dir with replace=false → conflict → stays REVIEW.
  const second = await regenerateRejectedAssets({
    audit_report_path: reportPath, output_root: approveOut, generator: goodGenerator(),
    approve_after_gate: true, replace: false, max_attempts_per_asset: 3,
  });
  assertFn(second.data.assets[0].status === QC_STATUS.REVIEW_REQUIRED, 'conflicting publish → NOT APPROVED (REVIEW_REQUIRED)');
  assertFn(second.data.assets[0].approved_dir === null, 'conflicting publish leaves approved_dir null');

  console.log(`\nREGEN RESULTS: ${passed} passed`);
  emitReport('regenerate', { assertions: passed, passed, failed: 0, startedAt: __startedAt });
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => { console.error(e); rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
