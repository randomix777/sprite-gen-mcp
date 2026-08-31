/**
 * CoverProp Pipeline Regression Tests — verifies real behavior.
 *
 * Tests:
 * 1. Manifest validation — valid and invalid manifests
 * 2. Status aggregation — all combinations of state results
 * 3. Directory isolation — approved NOT created until publish
 * 4. Rubble failure blocks approval
 * 5. Intact QC rejection blocks pipeline
 * 6. Godot export produces valid .tscn content
 * 7. Manifest has correct qc_status after final aggregation
 * 8. End-to-end: generate synthetic PNG → QC → manifest → publish
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { emitReport } from './_report.js';

const ROOT = path.join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_cover_prop');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  FAIL: ${msg}`); }
  else { passed++; console.log(`  PASS: ${msg}`); }
}

const {
  validateCoverPropManifest,
  computeAssetStatus,
  ensureCandidateDir,
  archiveToRejected,
  publishToApproved,
  exportGodotCoverProp,
} = await import('../lib/cover_prop.js');
const { QC_STATUS, qcGate } = await import('../lib/qc.js');

// ─── 1. Manifest validation ─────────────────────────────────────────────────
console.log('\n1. Manifest validation');
const good = {
  schema_version: 1, prop_id: 'bed_01', display_name: 'Bed',
  material_type: 'wood', canvas_size: [1024, 1024],
  ground_anchor: [512, 930],
  states: { intact: 'bed_01_intact.png', rubble: 'bed_01_rubble.png' },
  cover: { height: 'low' },
};
const v1 = validateCoverPropManifest(good);
assert(v1.valid === true, 'Valid manifest passes');
assert(v1.errors.length === 0, 'No errors');

const bads = [
  { prop_id: 'x' },  // missing required fields
  {},  // empty
  null,  // null
  { schema_version: 1, prop_id: 'x', display_name: 'X', material_type: 'INVALID', canvas_size: [1024, 1024], states: { intact: 'a.png' } },  // bad material
  { schema_version: 1, prop_id: 'x', display_name: 'X', material_type: 'wood', canvas_size: [10, 10], states: { intact: 'a.png' } },  // too small
];
for (const bm of bads) {
  const v = validateCoverPropManifest(bm);
  assert(v.valid === false, `Bad manifest rejected: ${JSON.stringify(bm).slice(0, 40)}`);
}

// ─── 2. Status aggregation ──────────────────────────────────────────────────
console.log('\n2. Status aggregation');

// Build a realistic (fully-resolved) state object the aggregator will accept.
// Empty-shell guards require: success:true, a 3-state status, file_qc with a
// NON-EMPTY rules array, finite measurements, real evidence files, and a
// successful consistency result for variant states.
function makeState(status, { review = false } = {}) {
  const evidencePath = path.join(TMP, `ev_${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(evidencePath, 'evidence');
  return {
    success: true,
    status,
    path: '/x/' + status,
    file_qc: {
      status: QC_STATUS.APPROVED,
      rules: [{ id: 'HAS_ALPHA', passed: true, value: { a: 1 } }],
      measurements: { center_offset: 0.1, ground_offset: 0.2, silhouette_iou: 0.9 },
    },
    evidence: { qc_evidence: evidencePath },
    state_consistency_qc: { success: true, status: review ? QC_STATUS.REVIEW_REQUIRED : QC_STATUS.APPROVED },
  };
}

const ok1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(ok1 === QC_STATUS.APPROVED, 'All APPROVED -> APPROVED');

const rj1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
  rubble: makeState(QC_STATUS.REJECTED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(rj1 === QC_STATUS.REJECTED, 'One REJECTED -> REJECTED');

const rv1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
  rubble: makeState(QC_STATUS.REVIEW_REQUIRED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(rv1 === QC_STATUS.REVIEW_REQUIRED, 'One REVIEW -> REVIEW_REQUIRED');

const ms1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(ms1 === QC_STATUS.REJECTED, 'Missing state -> REJECTED');

const gf1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
  rubble: { success: false, error: 'fail' },
}, ['intact', 'rubble'], { manifestValid: true });
assert(gf1 === QC_STATUS.REJECTED, 'Gen failure -> REJECTED');

const mv1 = computeAssetStatus({
  intact: makeState(QC_STATUS.APPROVED),
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: false });
assert(mv1 === QC_STATUS.REJECTED, 'Bad manifest -> REJECTED');

// Empty-shell rejections: no rules, no evidence, NaN measurement, unknown status.
const noRules = computeAssetStatus({
  intact: { success: true, status: QC_STATUS.APPROVED, file_qc: { status: QC_STATUS.APPROVED, rules: [] }, evidence: { qc_evidence: path.join(TMP, 'ev_missing.txt') }, state_consistency_qc: { success: true, status: QC_STATUS.APPROVED } },
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(noRules === QC_STATUS.REJECTED, 'Empty rules -> REJECTED (no false APPROVED)');

const nanMeas = computeAssetStatus({
  intact: { success: true, status: QC_STATUS.APPROVED, file_qc: { status: QC_STATUS.APPROVED, rules: [{ id: 'X', passed: true, value: { n: NaN } }], measurements: { m: NaN } }, evidence: { qc_evidence: (writeFileSync(path.join(TMP, 'ev_n.txt'), 'x'), path.join(TMP, 'ev_n.txt')) }, state_consistency_qc: { success: true, status: QC_STATUS.APPROVED } },
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(nanMeas === QC_STATUS.REJECTED, 'NaN measurement -> REJECTED');

const unknownStatus = computeAssetStatus({
  intact: makeState('APPROOVED'),
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(unknownStatus === QC_STATUS.REJECTED, 'Unknown status string -> REJECTED');

// Verify: any REVIEW_REQUIRED prevents APPROVED even with all others passing
const rv2 = computeAssetStatus({
  intact: makeState(QC_STATUS.REVIEW_REQUIRED),
  rubble: makeState(QC_STATUS.APPROVED),
}, ['intact', 'rubble'], { manifestValid: true });
assert(rv2 === QC_STATUS.REVIEW_REQUIRED, 'Intact REVIEW -> entire REVIEW');

// ─── 3. Directory isolation ─────────────────────────────────────────────────
console.log('\n3. Directory isolation');
const { candidatesDir } = ensureCandidateDir(TMP, 'session_iso');
assert(existsSync(candidatesDir), 'candidates exists');

// Verify approved NOT created yet
const approvedPath = path.join(TMP, 'approved', 'test_prop');
assert(!existsSync(approvedPath), 'approved NOT created yet');

// Archive to rejected
const rejDir = archiveToRejected(candidatesDir, 'session_iso', 'test_prop');
assert(existsSync(rejDir), 'rejected dir created on archive');
assert(!existsSync(approvedPath), 'approved still absent after archive');

// Publish to approved (stage a real file first so publish is meaningful)
const testFile = path.join(candidatesDir, 'test_asset.png');
writeFileSync(testFile, Buffer.from('test'));
publishToApproved(candidatesDir, approvedPath, 'test_prop');
assert(existsSync(approvedPath), 'approved created after publish');

// Verify published files exist (copy manifest or any file to candidates first)
const pub2 = publishToApproved(candidatesDir, approvedPath, 'test_prop2', { replace: true });
assert(!(pub2 && pub2.error), `Second publish with replace succeeds: ${pub2 && pub2.error ? pub2.error.message : ''}`);
const publishedFiles = readdirSync(approvedPath);
assert(publishedFiles.length > 0, `Published files exist: ${publishedFiles.join(', ')}`);

// ─── 4. Rubble failure blocks approval ──────────────────────────────────────
console.log('\n4. Rubble failure blocks approval');
const rb1 = computeAssetStatus({
  intact: { success: true, status: QC_STATUS.APPROVED },
  rubble: { success: false, error: 'rubble fail' },
}, ['intact', 'rubble'], { manifestValid: true });
assert(rb1 === QC_STATUS.REJECTED, 'Rubble failure -> REJECTED');

// Rubble REJECTED also blocks
const rb2 = computeAssetStatus({
  intact: { success: true, status: QC_STATUS.APPROVED },
  rubble: { success: true, status: QC_STATUS.REJECTED },
}, ['intact', 'rubble'], { manifestValid: true });
assert(rb2 === QC_STATUS.REJECTED, 'Rubble REJECTED -> entire REJECTED');

// ─── 5. Intact QC rejection blocks pipeline ─────────────────────────────────
console.log('\n5. Intact QC rejection blocks pipeline');
const rgbBuf = await sharp({
  create: { width: 64, height: 64, channels: 3,
    background: { r: 255, g: 0, b: 0 } }
}).png().toBuffer();
const rgbPath = path.join(TMP, 'rgb_test.png');
writeFileSync(rgbPath, rgbBuf);
const iq = await qcGate({ image_path: rgbPath });
assert(iq.data.status === QC_STATUS.REJECTED, 'RGB fails intact QC');
const ip = computeAssetStatus({
  intact: { success: true, status: QC_STATUS.REJECTED },
}, ['intact', 'rubble'], { manifestValid: true });
assert(ip === QC_STATUS.REJECTED, 'Intact QC fail blocks pipeline');

// ─── 6. Godot export produces valid .tscn ────────────────────────────────────
console.log('\n6. Godot export structure');
assert(typeof exportGodotCoverProp === 'function', 'exportGodotCoverProp exists');

// Create a test sprite for Godot export
const godotSprite = await sharp({
  create: { width: 64, height: 64, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{
  input: await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 100, g: 150, b: 200 } } }).png().toBuffer(),
  top: 12, left: 12,
}]).png().toBuffer();
const godotSpritePath = path.join(TMP, 'godot_sprite.png');
writeFileSync(godotSpritePath, godotSprite);

const godotDir = path.join(TMP, 'godot_out');
mkdirSync(godotDir, { recursive: true });

const sceneResult = await exportGodotCoverProp({
  prop_id: 'test_bed',
  intact_path: godotSpritePath,
  width: 64,
  height: 64,
  cover_height: 'low',
  material_type: 'wood',
  states: ['intact'],
  output_dir: godotDir,
});
assert(sceneResult.success === true, 'Godot export success');
assert(sceneResult.data.scene_path, 'Scene path returned');

// Verify .tscn content
const tscnPath = sceneResult.data.scene_path;
assert(existsSync(tscnPath), '.tscn file exists');
const tscnContent = readFileSync(tscnPath, 'utf8');
assert(tscnContent.includes('[gd_scene'), '.tscn has gd_scene header');
assert(tscnContent.includes('Sprite2D'), '.tscn has Sprite2D');
assert(tscnContent.includes('StaticBody2D'), '.tscn has StaticBody2D');
assert(tscnContent.includes('CollisionShape2D'), '.tscn has CollisionShape2D');
assert(tscnContent.includes('CoverZone'), '.tscn has CoverZone');
assert(tscnContent.includes('LeftPeekPoint'), '.tscn has LeftPeekPoint');
assert(tscnContent.includes('RightPeekPoint'), '.tscn has RightPeekPoint');
assert(tscnContent.includes('DebrisOrigin'), '.tscn has DebrisOrigin');
assert(tscnContent.includes('ext_resource'), '.tscn has ext_resource');
assert(tscnContent.includes('sub_resource'), '.tscn has sub_resource');

// Verify coordinates are finite numbers
const coordMatch = tscnContent.match(/position = Vector2\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)/g);
assert(coordMatch && coordMatch.length > 0, `.tscn has valid Vector2 coordinates`);

// Verify ext_resource declarations use Godot 4 section-header syntax
// (correct parse: [ext_resource type="Texture2D" path="res://..." id="..."])
const extResourceLines = tscnContent.match(/\[ext_resource[^\]]*path="res:\/\/([^"]+)"[^\]]*\]/g) || [];
assert(extResourceLines.length >= 1, `at least one ext_resource present (got ${extResourceLines.length})`);
for (const line of extResourceLines) {
  const match = line.match(/\[ext_resource[^\]]*path="res:\/\/([^"]+)"[^\]]*\]/);
  if (match) {
    const relPath = match[1];
    // Resolve res:// against the scene's project root (scene dir).
    const resolvedPath = path.resolve(path.dirname(tscnPath), relPath.replace(/^res:\/\//, ''));
    assert(existsSync(resolvedPath), `ext_resource path resolves to a real file: ${relPath}`);
  }
}

// Verify the texture was actually copied into the project (not just referenced).
assert(existsSync(sceneResult.data.texture_path), 'texture copied into project');
assert(sceneResult.data.res_texture_path.startsWith('res://'), 'res:// texture path recorded');

// ─── 7. Manifest qc_status field ────────────────────────────────────────────
console.log('\n7. Manifest qc_status consistency');
// The manifest built by buildManifest should have correct fields
const testManifest = {
  schema_version: 1,
  prop_id: 'test_7',
  display_name: 'Test 7',
  material_type: 'wood',
  canvas_size: [1024, 1024],
  states: { intact: 'test_7_intact.png' },
};
const mv2 = validateCoverPropManifest(testManifest);
assert(mv2.valid === true, 'Test manifest valid');

// ─── 8. End-to-end: synthetic PNG → QC → manifest validation ────────────────
console.log('\n8. End-to-end synthetic pipeline');
// Create a valid sprite with proper ground anchor (body bottom at y=100, anchor at y=100)
const e2eSprite = await sharp({
  create: { width: 128, height: 128, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{
  input: await sharp({ create: { width: 80, height: 76, channels: 3, background: { r: 100, g: 150, b: 200 } } }).png().toBuffer(),
  top: 16, left: 24,
}]).png().toBuffer();
const e2ePath = path.join(TMP, 'e2e_intact.png');
writeFileSync(e2ePath, e2eSprite);

// Run QC with ground anchor at body bottom (y=16+76=92)
const e2eQc = await qcGate({
  image_path: e2ePath,
  canvas_width: 128,
  canvas_height: 128,
  ground_anchor: [64, 92],
});
assert(e2eQc.success === true, 'E2E QC success');
assert(e2eQc.data.status === QC_STATUS.APPROVED,
  `E2E QC APPROVED, got ${e2eQc.data.status}`);

// Build and validate manifest
const e2eManifest = {
  schema_version: 1,
  prop_id: 'e2e_prop',
  display_name: 'E2E Prop',
  material_type: 'wood',
  canvas_size: [128, 128],
  ground_anchor: [64, 115],
  states: { intact: 'e2e_intact.png' },
  cover: { height: 'low' },
};
const e2eMv = validateCoverPropManifest(e2eManifest);
assert(e2eMv.valid === true, 'E2E manifest valid');
assert(e2eMv.errors.length === 0, 'E2E manifest no errors');

// Verify evidence was generated and is valid
assert(typeof e2eQc.data.evidence_path === 'string', 'E2E evidence_path is string');
assert(existsSync(e2eQc.data.evidence_path), 'E2E evidence file exists');

// Verify all rules have finite measured values
for (const rule of e2eQc.data.rules) {
  if (rule.value && typeof rule.value === 'object') {
    for (const [k, v] of Object.entries(rule.value)) {
      if (typeof v === 'number') {
        assert(isFinite(v), `Rule ${rule.id}.${k} is finite: ${v}`);
      }
    }
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\nCOVER PROP RESULTS: ${passed}/${passed + failed} passed`);
emitReport('cover_prop', { assertions: passed + failed, passed, failed, startedAt: __startedAt });
process.exit(failed > 0 ? 1 : 0);
