/**
 * Test: failure_injection — negative tests proving QC gates actually REJECT bad
 * assets (no false-green). Injects real defective sprites and asserts rejection
 * with specific, real hard-failure reasons.
 */
import assert from 'assert';
import sharp from 'sharp';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { qcGate, QC_STATUS } from '../lib/qc.js';
import { emitReport } from './_report.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'test', 'tmp_failure_injection');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0;
function ok(name) { passed++; console.log('  PASS:', name); }
function assertFn(cond, name) { assert(cond, name); ok(name); }

// Inject a defective image and run QC; assert the named rule fails.
async function injectAndReject(buf, label, expectedRule) {
  const p = path.join(TMP, `${label}.png`);
  writeFileSync(p, buf);
  const res = await qcGate({ image_path: p, canvas_width: 128, canvas_height: 128 });
  assertFn(res.success === true, `${label}: qcGate returns ok envelope`);
  assertFn(res.data.status === QC_STATUS.REJECTED, `${label}: REJECTED (got ${res.data.status})`);
  if (expectedRule) {
    const rule = res.data.rules.find(r => r.id === expectedRule);
    assertFn(rule && rule.passed === false, `${label}: hard failure '${expectedRule}' present`);
  }
  return res;
}

async function main() {
  // RGB-only (no alpha) at correct canvas size → HAS_ALPHA fails
  const rgb = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  await injectAndReject(rgb, 'rgb_only', 'HAS_ALPHA');

  // Checkerboard background → CHECKERBOARD fails (not silently approved)
  let rects = '';
  const s = 8;
  for (let y = 0; y < 128; y += s) for (let x = 0; x < 128; x += s) {
    const c = ((x / s + y / s) % 2 === 0) ? '0,0,0' : '255,255,255';
    rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="rgb(${c})"/>`;
  }
  const checker = await sharp(Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`)).png().toBuffer();
  await injectAndReject(checker, 'checkerboard', 'CHECKERBOARD');

  // Opaque white background (alpha 255 everywhere, no transparency) at correct size → TRANSPARENCY fails
  const whiteBg = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  await injectAndReject(whiteBg, 'white_bg', 'TRANSPARENCY_RATIO');

  // Valid sprite → APPROVED (control)
  const svg = `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="20" width="88" height="88" rx="8" fill="rgb(100,150,200)"/></svg>`;
  const valid = await sharp(Buffer.from(svg)).png().toBuffer();
  const vp = path.join(TMP, 'valid.png');
  writeFileSync(vp, valid);
  const vres = await qcGate({ image_path: vp, canvas_width: 128, canvas_height: 128 });
  assertFn(vres.data.status === QC_STATUS.APPROVED || vres.data.status === QC_STATUS.REVIEW_REQUIRED, `valid asset not rejected (got ${vres.data.status})`);

  // Corrupt/truncated file → FILE_NOT_FOUND / decode failure (no crash, no approve)
  const trunc = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]); // PNG header only
  const tp = path.join(TMP, 'truncated.png');
  writeFileSync(tp, trunc);
  const tres = await qcGate({ image_path: tp });
  assertFn(tres.success === false || tres.data?.status === QC_STATUS.REJECTED, 'truncated file not approved');

  // Non-existent file → FILE_NOT_FOUND
  const nf = await qcGate({ image_path: path.join(TMP, 'does_not_exist.png') });
  assertFn(nf.success === false, 'missing file rejected');

  console.log(`\nFAILURE INJECTION RESULTS: ${passed} passed`);
  emitReport('failure_injection', { assertions: passed, passed, failed: 0, startedAt: __startedAt });
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => { console.error(e); rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
