/**
 * Test: audit.js — real per-asset audit with honest assertions.
 *
 * No false-green: every assertion checks a real, measured value. We generate
 * synthetic transparent sprites with sharp and an intentionally-invalid asset
 * (opaque / checkerboard) to force a REJECTED verdict, then assert the audit
 * reflects it.
 */
import assert from 'assert';
import sharp from 'sharp';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { auditAssets } from '../lib/audit.js';
import { QC_STATUS } from '../lib/qc.js';
import { emitReport } from './_report.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'test', 'tmp_audit');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0;
function ok(name) { passed++; console.log('  PASS:', name); }
function assertFn(cond, name) { assert(cond, name); ok(name); }

async function makeSprite(w, h, color, pad) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="${pad}" y="${pad}" width="${w - 2 * pad}" height="${h - 2 * pad}" rx="6" fill="rgb(${color.r},${color.g},${color.b})"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  // ── 1. Valid cover prop set → APPROVED ──
  const goodDir = path.join(TMP, 'good');
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(path.join(goodDir, 'bed_intact.png'), await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20));
  writeFileSync(path.join(goodDir, 'bed_rubble.png'), await makeSprite(128, 128, { r: 120, g: 130, b: 140 }, 22));

  const good = await auditAssets({ input_path: goodDir, report_dir: path.join(TMP, 'report_good'), strict: true, asset_type: 'cover_prop' });
  assertFn(good.success === true, 'audit of valid dir succeeds');
  assertFn(Array.isArray(good.data.assets) && good.data.assets.length === 2, `found 2 assets (got ${good.data.assets?.length})`);
  assertFn(good.data.summary.approved === 2, `summary approved=2 (got ${good.data.summary.approved})`);
  assertFn(good.data.summary.rejected === 0, 'summary rejected=0');
  assertFn(good.data.assets.every(a => a.status === QC_STATUS.APPROVED), 'every asset APPROVED');
  const goodReport = path.join(TMP, 'report_good', 'asset_audit.json');
  assertFn(existsSync(goodReport), 'asset_audit.json written');
  const goodCsv = path.join(TMP, 'report_good', 'asset_audit.csv');
  assertFn(existsSync(goodCsv), 'asset_audit.csv written');
  // Evidence files actually exist
  const evIdx = path.join(TMP, 'report_good', 'evidence', 'index.json');
  assertFn(existsSync(evIdx), 'evidence index written');

  // ── 2. Invalid asset (opaque RGB) → REJECTED ──
  const badDir = path.join(TMP, 'bad');
  mkdirSync(badDir, { recursive: true });
  const opaque = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
  writeFileSync(path.join(badDir, 'broken_intact.png'), opaque);

  const bad = await auditAssets({ input_path: badDir, report_dir: path.join(TMP, 'report_bad'), strict: true, asset_type: 'cover_prop' });
  assertFn(bad.success === true, 'audit of invalid dir succeeds');
  assertFn(bad.data.summary.rejected >= 1, `summary rejected>=1 (got ${bad.data.summary.rejected})`);
  const broken = bad.data.assets.find(a => a.asset_path.includes('broken_intact'));
  assertFn(broken && broken.status === QC_STATUS.REJECTED, 'broken asset is REJECTED');
  assertFn(broken && Array.isArray(broken.hard_failures) && broken.hard_failures.length > 0, 'broken asset has real hard_failures');
  assertFn(broken.hard_failures.includes('HAS_ALPHA'), 'HAS_ALPHA failure reported for opaque image');

  // ── 3. strict mode: a REJECTED asset is NOT silently approved ──
  assertFn(bad.data.summary.approved === 0, 'strict mode: rejected asset not counted as approved');

  // ── 4. report_dir inside input_path is rejected (prevents recursion) ──
  const nested = await auditAssets({ input_path: goodDir, report_dir: path.join(goodDir, 'sub'), strict: true });
  assertFn(nested.success === false, 'report_dir inside input_path rejected');

  // ── 6. Summary conservation when consistency flips rubble → REJECTED (Phase 2 #3) ──
  const grpDir = path.join(TMP, 'grouped');
  mkdirSync(grpDir, { recursive: true });
  // intact: a large centered body
  writeFileSync(path.join(grpDir, 'chair_intact.png'), await makeSprite(128, 128, { r: 90, g: 140, b: 210 }, 20));
  // rubble: a tiny off-corner dot → silhouette mismatch → consistency REJECTED
  const dot = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
    { input: await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 130, b: 140 } } }).png().toBuffer(), top: 90, left: 90 },
  ]).png().toBuffer();
  writeFileSync(path.join(grpDir, 'chair_rubble.png'), dot);

  const grp = await auditAssets({ input_path: grpDir, report_dir: path.join(TMP, 'report_grp'), strict: true, asset_type: 'cover_prop' });
  assertFn(grp.success === true, 'grouped audit succeeds');
  const s = grp.data.summary;
  const total = s.approved + s.rejected + s.review_required + s.unknown;
  assertFn(total === s.total_scanned, `summary conserves: approved+review+rejected+unknown == total (${total} vs ${s.total_scanned})`);
  assertFn(s.conserved === true, 'summary.conserved flag true');
  const rub = grp.data.assets.find(a => a.asset_path.includes('chair_rubble'));
  assertFn(rub && rub.status === QC_STATUS.REJECTED, 'dissimilar rubble → REJECTED via consistency');
  assertFn(rub && rub.hard_failures.includes('STATE_CONSISTENCY'), 'STATE_CONSISTENCY failure recorded');
  // Crucially: total accepted+rejected must NOT exceed scanned count.
  assertFn(s.approved + s.rejected <= s.total_scanned, 'accepted+rejected never exceeds scanned');

  console.log(`\nAUDIT RESULTS: ${passed} passed`);
  emitReport('audit', { assertions: passed, passed, failed: 0, startedAt: __startedAt });
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => { console.error(e); rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
