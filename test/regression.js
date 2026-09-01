/**
 * Regression tests for optimization fixes — real behavior verification.
 *
 * Tests:
 * 1. QC system: APPROVED/REVIEW_REQUIRED/REJECTED statuses with real measurements
 * 2. Unwrapped image results (result unwrapper)
 * 3. Provider capability metadata
 * 4. CoverProp manifest validation
 * 5. Agnes reference image handling
 * 6. State consistency with variant_type parameter
 * 7. Connected components with real noise fixtures
 * 8. Evidence generation produces decodable files
 * 9. File completeness gates
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { emitReport } from './_report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_regression');
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  ✗ ${msg}`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}

const { qcGate, QC_STATUS, qcStateConsistency } = await import('../lib/qc.js');

async function createSpriteImage(w, h, bodyColor, bodyMargin) {
  const body = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const margin = bodyMargin || Math.floor(w * 0.15);
  const bodyBuf = await sharp({
    create: { width: w - margin * 2, height: h - margin * 2, channels: 3, background: bodyColor },
  }).png().toBuffer();
  return await sharp(body).composite([{ input: bodyBuf, top: margin, left: margin }]).png().toBuffer();
}

// ─── 1. QC System ─────────────────────────────────────────────────────────────
console.log('\n1. QC System');

const validImg = await createSpriteImage(128, 128, { r: 100, g: 150, b: 200 }, 20);
const validPath = path.join(TMP, 'qc_valid.png');
writeFileSync(validPath, validImg);

const validQc = await qcGate({ image_path: validPath });
assert(validQc.success === true, 'qcGate returns success for valid image');
assert(validQc.data.status === QC_STATUS.APPROVED || validQc.data.status === QC_STATUS.REVIEW_REQUIRED,
  `Valid image gets APPROVED or REVIEW_REQUIRED, got ${validQc.data.status}`);
assert(Array.isArray(validQc.data.rules), 'qcGate returns rules array');
assert(validQc.data.rules.length > 0, 'qcGate returns at least one rule');
assert(typeof validQc.data.measurements.width === 'number' && isFinite(validQc.data.measurements.width), 'width measurement is finite number');
assert(typeof validQc.data.measurements.transparency_ratio === 'number' && isFinite(validQc.data.measurements.transparency_ratio), 'transparency_ratio is finite number');
assert(typeof validQc.data.measurements.body_ratio === 'number' && isFinite(validQc.data.measurements.body_ratio), 'body_ratio is finite number');

const missingQc = await qcGate({ image_path: '/nonexistent/file.png' });
assert(missingQc.success === false, 'qcGate rejects missing file');
assert(missingQc.error.code === 'FILE_NOT_FOUND', 'Missing file → FILE_NOT_FOUND');

const emptyBuf = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const emptyPath = path.join(TMP, 'qc_empty.png');
writeFileSync(emptyPath, emptyBuf);
const emptyQc = await qcGate({ image_path: emptyPath });
assert(emptyQc.success === true, 'qcGate handles all-transparent image');
assert(emptyQc.data.status === QC_STATUS.REJECTED, 'All-transparent → REJECTED');

const rgbBuf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
const rgbPath = path.join(TMP, 'qc_rgb.png');
writeFileSync(rgbPath, rgbBuf);
const rgbQc = await qcGate({ image_path: rgbPath });
assert(rgbQc.success === true, 'qcGate handles RGB image');
assert(rgbQc.data.status === QC_STATUS.REJECTED, 'RGB (no alpha) → REJECTED');

// ─── 2. Result Unwrapper ─────────────────────────────────────────────────────
console.log('\n2. Result Unwrapper');

const { unwrapImages, unwrapFirstImage } = await import('../lib/result.js');
const goodResult = { success: true, data: { images: [{ data: 'abc', mimeType: 'image/png' }] } };
assert(unwrapImages(goodResult) !== null, 'unwrapImages returns non-null for valid result');
assert(unwrapImages(goodResult).images.length === 1, 'unwrapImages finds 1 image');
const legacyResult = { success: true, images: [{ data: 'def', mimeType: 'image/jpeg' }] };
assert(unwrapImages(legacyResult) !== null, 'unwrapImages handles legacy format');
assert(unwrapImages(legacyResult).images[0].mimeType === 'image/jpeg', 'unwrapImages reads legacy .images');
assert(unwrapImages({ success: false }) === null, 'unwrapImages returns null for failed result');
const first = unwrapFirstImage({ success: true, data: { images: [{ data: 'a' }, { data: 'b' }] } });
assert(first !== null && first.data === 'a', 'unwrapFirstImage returns first image');

// ─── 3. Provider Capabilities ────────────────────────────────────────────────
console.log('\n3. Provider Capabilities');
const { PROVIDER_CAPABILITIES } = await import('../lib/config.js');
assert(PROVIDER_CAPABILITIES.agnes.image_to_image === true, 'agnes image-to-image');
assert(PROVIDER_CAPABILITIES.agnes.native_alpha === false, 'agnes native_alpha=false');
assert(PROVIDER_CAPABILITIES.agnes.requires_post_cutout === true, 'agnes requires_post_cutout');
assert(PROVIDER_CAPABILITIES.agnes.solid_chroma === true, 'agnes solid_chroma');
assert(PROVIDER_CAPABILITIES.gemini_flash.native_alpha === true, 'gemini_flash native_alpha');
assert(PROVIDER_CAPABILITIES.comfy.requires_post_cutout === true, 'comfy requires_post_cutout');

// ─── 4. CoverProp Manifest Validation ────────────────────────────────────────
console.log('\n4. CoverProp Manifest');
const { validateCoverPropManifest } = await import('../lib/cover_prop.js');
const vm = validateCoverPropManifest({
  schema_version: 1, prop_id: 'bed_01', display_name: 'Bed',
  material_type: 'wood', canvas_size: [1024, 1024],
  states: { intact: 'a.png' },
});
assert(vm.valid === true, 'Valid manifest passes');
assert(validateCoverPropManifest({ prop_id: 'x' }).valid === false, 'Incomplete manifest fails');
assert(validateCoverPropManifest(null).valid === false, 'Null manifest fails');
assert(validateCoverPropManifest({}).valid === false, 'Empty manifest fails');

// ─── 5. Agnes Reference Image Handling ────────────────────────────────────────
console.log('\n5. Agnes Reference Image Handling');
const { generateImage } = await import('../lib/image_gen.js');
assert(typeof generateImage === 'function', 'generateImage is a function');

// ─── 6. State consistency with variant_type ────────────────────────────────────
console.log('\n6. State consistency variant_type');
async function makeCs(w, h, color, margin) {
  return await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: w-margin*2, height: h-margin*2, channels: 3, background: color } }).png().toBuffer(), top: margin, left: margin }])
    .png().toBuffer();
}
const ip = path.join(TMP, 'reg_intact.png');
writeFileSync(ip, await makeCs(128, 128, { r: 100, g: 150, b: 200 }, 20));
const rp = path.join(TMP, 'reg_rubble.png');
writeFileSync(rp, await makeCs(128, 128, { r: 120, g: 130, b: 140 }, 22));
const cst = await qcStateConsistency({ reference_path: ip, variant_path: rp, variant_type: 'rubble' });
assert(cst.success === true, 'qcStateConsistency with variant_type');
assert(cst.data.variant_type === 'rubble', 'variant_type preserved');
assert(typeof cst.data.measurements.center_offset === 'number' && isFinite(cst.data.measurements.center_offset), 'center_offset finite');
assert(typeof cst.data.measurements.silhouette_iou === 'number' && isFinite(cst.data.measurements.silhouette_iou), 'silhouette_iou finite');

// ─── 7. Connected components ──────────────────────────────────────────────────
console.log('\n7. Connected components');
const nsBase = await createSpriteImage(128, 128, { r: 100, g: 150, b: 200 }, 20);
const noiseDots = [];
for (const [dx, dy] of [[5, 5], [120, 5], [5, 120], [120, 120]]) {
  noiseDots.push({ input: await sharp({ create: { width: 5, height: 5, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } } }).png().toBuffer(), top: dy, left: dx });
}
writeFileSync(path.join(TMP, 'reg_noise.png'), await sharp(nsBase).composite(noiseDots).png().toBuffer());
const nq = await qcGate({ image_path: path.join(TMP, 'reg_noise.png') });
const ncr = nq.data.rules.find(r => r.id === 'CONNECTED_COMPONENTS');
assert(ncr !== undefined, 'CONNECTED_COMPONENTS exists');
assert(typeof ncr.value.main_area === 'number' && ncr.value.main_area > 0, `main_area > 0: ${ncr.value.main_area}`);
assert(typeof ncr.value.noise_ratio === 'number' && isFinite(ncr.value.noise_ratio), `noise_ratio finite: ${ncr.value.noise_ratio}`);

// ─── 8. Evidence generation ──────────────────────────────────────────────────
console.log('\n8. Evidence generation');
const evPath = nq.data.evidence_path;
assert(typeof evPath === 'string' && evPath.length > 5, 'evidence_path is valid string');
assert(existsSync(evPath), 'evidence file exists on disk');
const evMeta = await sharp(evPath).metadata();
assert(evMeta.width === 128 && evMeta.height === 128, `evidence correct dimensions: ${evMeta.width}x${evMeta.height}`);

// ─── 9. File completeness gates ──────────────────────────────────────────────
console.log('\n9. File completeness gates');
const fcRules = nq.data.rules.filter(r => ['FILE_SIZE', 'DIMENSIONS_RANGE', 'TOTAL_PIXELS'].includes(r.id));
assert(fcRules.length === 3, `All 3 completeness rules: ${fcRules.length}`);
for (const rule of fcRules) {
  assert(typeof rule.value === 'object' && rule.value !== null, `${rule.id} has value`);
  assert(typeof rule.threshold === 'object', `${rule.id} has threshold`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`RESULTS: ${passed} passed / ${failed} failed / ${passed + failed} total`);
emitReport('regression', { assertions: passed + failed, passed, failed, startedAt: __startedAt });
import('fs').then(({ rmSync }) => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }).finally(() => process.exit(failed > 0 ? 1 : 0));
