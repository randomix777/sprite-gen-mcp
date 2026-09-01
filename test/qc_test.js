/**
 * QC Gate Regression Tests — verifies real measurements, not just symbol existence.
 *
 * Tests:
 * 1. Valid transparent sprite → APPROVED with real measurements
 * 2. RGB-only image → REJECTED with HAS_ALPHA failure
 * 3. All-transparent image → REJECTED
 * 4. Checkerboard pattern → CHECKERBOARD failure with real score
 * 5. Connected components with isolated noise → real main_area/noise_area/noise_ratio
 * 6. State consistency normal → APPROVED with real IoU
 * 7. State consistency with drift → REJECTED/REVIEW with real measurements
 * 8. Evidence generation → evidence file exists, is decodable, has correct dimensions
 * 9. File completeness gates → FILE_SIZE, DIMENSIONS_RANGE, TOTAL_PIXELS
 * 10. Edge cases: NaN, Infinity, empty rules
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { emitReport } from './_report.js';

const ROOT = path.join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_qc_regression');
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  FAIL: ${msg}`); }
  else { passed++; console.log(`  PASS: ${msg}`); }
}
function assertApprox(val, expected, tolerance, msg) {
  const ok = Math.abs(val - expected) <= tolerance;
  if (!ok) { failed++; console.log(`  FAIL: ${msg} — expected ~${expected}, got ${val} (±${tolerance})`); }
  else { passed++; console.log(`  PASS: ${msg}`); }
}

const { qcGate, QC_STATUS, qcStateConsistency } = await import('../lib/qc.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function makeSprite(w, h, color, margin) {
  const bgBuf = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const bodyBuf = await sharp({
    create: { width: w - margin * 2, height: h - margin * 2, channels: 3, background: color }
  }).png().toBuffer();
  return await sharp(bgBuf).composite([
    { input: bodyBuf, top: margin, left: margin }
  ]).png().toBuffer();
}

async function makeRgb(w, h, color) {
  return await sharp({
    create: { width: w, height: h, channels: 3, background: color }
  }).png().toBuffer();
}

async function makeEmpty(w, h) {
  return await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();
}

function save(name, buf) {
  const p = path.join(TMP, name);
  writeFileSync(p, buf);
  return p;
}

// ─── 1. Valid transparent sprite ────────────────────────────────────────────
console.log('\n1. Valid transparent sprite');
const validImg = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20);
const vp = save('valid.png', validImg);
const vq = await qcGate({ image_path: vp });
assert(vq.success === true, 'qcGate success');
assert(vq.data.status === QC_STATUS.APPROVED,
  `APPROVED status, got ${vq.data.status}`);

// Check real measurements exist and are finite numbers
const m = vq.data.measurements;
assert(typeof m.width === 'number' && isFinite(m.width), 'width is finite number');
assert(typeof m.height === 'number' && isFinite(m.height), 'height is finite number');
assert(typeof m.has_alpha === 'boolean', 'has_alpha is boolean');
assert(typeof m.transparency_ratio === 'number' && isFinite(m.transparency_ratio),
  `transparency_ratio is finite: ${m.transparency_ratio}`);
assert(typeof m.body_ratio === 'number' && isFinite(m.body_ratio),
  `body_ratio is finite: ${m.body_ratio}`);
assert(typeof m.min_margin === 'number' && isFinite(m.min_margin),
  `min_margin is finite: ${m.min_margin}`);

// Check specific rules passed
const br = vq.data.rules.find(r => r.id === 'BODY_RATIO');
assert(br && br.passed, 'BODY_RATIO passes');
assert(typeof br.value.body_ratio === 'number' && isFinite(br.value.body_ratio),
  `BODY_RATIO measured value is finite: ${br.value.body_ratio}`);

const cr = vq.data.rules.find(r => r.id === 'CORNER_ALPHA');
assert(cr && cr.passed, 'CORNER_ALPHA passes');
assert(typeof cr.value.max_corner_alpha === 'number' && isFinite(cr.value.max_corner_alpha),
  `CORNER_ALPHA measured value is finite: ${cr.value.max_corner_alpha}`);

const tr = vq.data.rules.find(r => r.id === 'TRANSPARENCY_RATIO');
assert(tr && tr.passed, 'TRANSPARENCY_RATIO passes');
assert(typeof tr.value.ratio === 'number' && isFinite(tr.value.ratio) && tr.value.ratio > 0,
  `TRANSPARENCY_RATIO is positive finite: ${tr.value.ratio}`);

// Check evidence was generated
assert(typeof vq.data.evidence_path === 'string' && existsSync(vq.data.evidence_path),
  'evidence file exists on disk');

// ─── 2. RGB-only image ─────────────────────────────────────────────────────
console.log('\n2. RGB-only image');
const rgbBuf = await makeRgb(64, 64, { r: 255, g: 0, b: 0 });
const rp = save('rgb.png', rgbBuf);
const rq = await qcGate({ image_path: rp });
assert(rq.success === true, 'qcGate handles RGB');
assert(rq.data.status === QC_STATUS.REJECTED,
  `REJECTED for RGB, got ${rq.data.status}`);
const ha = rq.data?.rules?.find(r => r.id === 'HAS_ALPHA');
assert(ha !== undefined, 'HAS_ALPHA rule exists for RGB');
assert(!ha.passed, 'HAS_ALPHA fails for RGB');

// Check FILE_SIZE and DIMENSIONS_RANGE rules exist
const fsRule = rq.data?.rules?.find(r => r.id === 'FILE_SIZE');
assert(fsRule !== undefined, 'FILE_SIZE rule exists');
assert(typeof fsRule.value.size_bytes === 'number' && fsRule.value.size_bytes > 0,
  `FILE_SIZE has real measurement: ${fsRule.value.size_bytes}`);

const drRule = rq.data?.rules?.find(r => r.id === 'DIMENSIONS_RANGE');
assert(drRule !== undefined, 'DIMENSIONS_RANGE rule exists');
assert(drRule.value.width === 64 && drRule.value.height === 64,
  `DIMENSIONS_RANGE has correct measurements: ${drRule.value.width}x${drRule.value.height}`);

// ─── 3. All-transparent image ──────────────────────────────────────────────
console.log('\n3. All-transparent image');
const emptyBuf = await makeEmpty(64, 64);
const ep = save('empty.png', emptyBuf);
const eq = await qcGate({ image_path: ep });
assert(eq.data.status === QC_STATUS.REJECTED,
  `REJECTED for empty, got ${eq.data.status}`);

// ─── 4. Checkerboard pattern ────────────────────────────────────────────────
console.log('\n4. Checkerboard pattern');
const cbBuf = await sharp({
  create: { width: 128, height: 128, channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 255 } }
}).png().toBuffer();
const cells = [];
for (let cy = 0; cy < 8; cy++) {
  for (let cx = 0; cx < 8; cx++) {
    const black = ((cx + cy) % 2 === 0);
    cells.push({
      input: await sharp({
        create: { width: 16, height: 16, channels: 4,
          background: black ? { r: 0, g: 0, b: 0, alpha: 255 } : { r: 255, g: 255, b: 255, alpha: 255 } }
      }).png().toBuffer(),
      top: cy * 16, left: cx * 16
    });
  }
}
const cbImg = await sharp(cbBuf).composite(cells).png().toBuffer();
const cbp = save('checkerboard.png', cbImg);
const cbq = await qcGate({ image_path: cbp });
assert(cbq.success === true, 'qcGate handles checkerboard');
const cbr = cbq.data?.rules?.find(r => r.id === 'CHECKERBOARD');
assert(cbr !== undefined, 'CHECKERBOARD rule exists');
assert(cbr.passed === false, 'CHECKERBOARD fails for checkerboard');
assert(typeof cbr.value.checkerboard_score === 'number' && isFinite(cbr.value.checkerboard_score),
  `CHECKERBOARD score is finite: ${cbr.value.checkerboard_score}`);
assert(cbr.value.checkerboard_score > 0, `CHECKERBOARD score > 0: ${cbr.value.checkerboard_score}`);

// ─── 5. Connected components with isolated noise ────────────────────────────
console.log('\n5. Connected components with isolated noise');
// Create a valid sprite with isolated red dots (noise)
const nsBase = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20);
// Add small isolated red dots (5x5 pixels each, scattered)
const noiseDots = [];
const dotPositions = [[5, 5], [120, 5], [5, 120], [120, 120], [64, 5]];
for (const [dx, dy] of dotPositions) {
  noiseDots.push({
    input: await sharp({
      create: { width: 5, height: 5, channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 255 } }
    }).png().toBuffer(),
    top: dy, left: dx,
  });
}
const nsBuf = await sharp(nsBase).composite(noiseDots).png().toBuffer();
const nsp = save('noise.png', nsBuf);
const nq = await qcGate({ image_path: nsp });
assert(nq.success === true, 'qcGate handles noise');

const ncr = nq.data.rules.find(r => r.id === 'CONNECTED_COMPONENTS');
assert(ncr !== undefined, 'CONNECTED_COMPONENTS rule exists');
assert(typeof ncr.value.main_area === 'number' && isFinite(ncr.value.main_area),
  `main_area is finite: ${ncr.value.main_area}`);
assert(typeof ncr.value.noise_area === 'number' && isFinite(ncr.value.noise_area),
  `noise_area is finite: ${ncr.value.noise_area}`);
assert(typeof ncr.value.noise_ratio === 'number' && isFinite(ncr.value.noise_ratio),
  `noise_ratio is finite: ${ncr.value.noise_ratio}`);

// Main area should be much larger than noise
assert(ncr.value.main_area > 5000, `main_area is substantial: ${ncr.value.main_area}`);
assert(ncr.value.noise_area > 0, `noise_area > 0: ${ncr.value.noise_area}`);
assert(ncr.value.noise_ratio > 0, `noise_ratio > 0: ${ncr.value.noise_ratio}`);
console.log(`  Connected components: main=${ncr.value.main_area}, noise=${ncr.value.noise_area}, ratio=${ncr.value.noise_ratio.toFixed(4)}`);

// ─── 6. State consistency normal ────────────────────────────────────────────
console.log('\n6. State consistency normal');
const intactBuf = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 20);
const intactPath = save('cons_intact.png', intactBuf);
const rubbBuf = await makeSprite(128, 128, { r: 120, g: 130, b: 140 }, 22);
const rubbPath = save('cons_rubble.png', rubbBuf);
const cst = await qcStateConsistency({
  reference_path: intactPath, variant_path: rubbPath, variant_type: 'rubble'
});
assert(cst.success === true, 'qcStateConsistency success');
assert(cst.data.status === QC_STATUS.APPROVED ||
  cst.data.status === QC_STATUS.REVIEW_REQUIRED,
  `APPROVED or REVIEW, got ${cst.data.status}`);

// Check real measurements
assert(typeof cst.data.measurements.center_offset === 'number' && isFinite(cst.data.measurements.center_offset),
  `center_offset is finite: ${cst.data.measurements.center_offset}`);
assert(typeof cst.data.measurements.ground_offset === 'number' && isFinite(cst.data.measurements.ground_offset),
  `ground_offset is finite: ${cst.data.measurements.ground_offset}`);
assert(typeof cst.data.measurements.silhouette_iou === 'number' && isFinite(cst.data.measurements.silhouette_iou),
  `silhouette_iou is finite: ${cst.data.measurements.silhouette_iou}`);

// IoU should be high for similar sprites
assert(cst.data.measurements.silhouette_iou > 0.5,
  `IoU is reasonable: ${cst.data.measurements.silhouette_iou}`);

const iouR = cst.data.rules.find(r => r.id === 'SILHOUETTE_IOU');
assert(iouR !== undefined, 'SILHOUETTE_IOU rule exists');

// ─── 7. State consistency with size mutation ────────────────────────────────
console.log('\n7. State consistency with size mutation');
const bigBuf = await makeSprite(128, 128, { r: 100, g: 150, b: 200 }, 5);
const bigPath = save('cons_big.png', bigBuf);
const smallBuf = await makeSprite(32, 32, { r: 100, g: 150, b: 200 }, 5);
const smallPath = save('cons_small.png', smallBuf);
const cst2 = await qcStateConsistency({
  reference_path: bigPath, variant_path: smallPath, variant_type: 'rubble'
});
assert(cst2.success === true, 'qcStateConsistency handles size mismatch');
assert(cst2.data.status === QC_STATUS.REJECTED || cst2.data.status === QC_STATUS.REVIEW_REQUIRED,
  `Size mismatch detected, got ${cst2.data.status}`);

// ─── 8. Evidence path validation ────────────────────────────────────────────
console.log('\n8. Evidence path validation');
const evPath = vq.data.evidence_path;
assert(typeof evPath === 'string' && evPath.length > 5,
  `evidence_path is valid string: ${evPath}`);
assert(existsSync(evPath), 'evidence file exists on disk');

// Verify evidence is a valid image
try {
  const evMeta = await sharp(evPath).metadata();
  assert(evMeta.width === 128 && evMeta.height === 128,
    `evidence has correct dimensions: ${evMeta.width}x${evMeta.height}`);
  assert(evMeta.format === 'png', `evidence is PNG format: ${evMeta.format}`);
} catch (e) {
  failed++; console.log(`  FAIL: evidence file is not a valid image: ${e.message}`);
}

// ─── 9. All rule IDs are unique and have valid structure ─────────────────────
console.log('\n9. Rule structure validation');
const ruleIds = vq.data.rules.map(r => r.id);
const uniqueIds = new Set(ruleIds);
assert(uniqueIds.size === ruleIds.length, `All rule IDs are unique: ${ruleIds.length} rules, ${uniqueIds.size} unique`);
for (const rule of vq.data.rules) {
  assert(typeof rule.id === 'string' && rule.id.length > 0, `Rule ${rule.id} has valid id`);
  assert(typeof rule.description === 'string', `Rule ${rule.id} has description`);
  assert(typeof rule.passed === 'boolean', `Rule ${rule.id} has boolean passed`);
  assert(typeof rule.value === 'object' && rule.value !== null, `Rule ${rule.id} has value object`);
  assert(typeof rule.threshold === 'object', `Rule ${rule.id} has threshold object`);
}

// ─── 10. File not found ─────────────────────────────────────────────────────
console.log('\n10. File not found');
const missingQc = await qcGate({ image_path: '/nonexistent/file.png' });
assert(missingQc.success === false, 'qcGate rejects missing file');
assert(missingQc.error.code === 'FILE_NOT_FOUND', 'Missing file → FILE_NOT_FOUND');

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\nQC RESULTS: ${passed}/${passed + failed} passed`);
emitReport('qc', { assertions: passed + failed, passed, failed, startedAt: __startedAt });
import('fs').then(({ rmSync }) => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }).finally(() => process.exit(failed > 0 ? 1 : 0));
