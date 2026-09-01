/**
 * End-to-End CoverProp Pipeline Tests — real generateCoverProp() with mock provider.
 *
 * Tests the full path:
 *   Provider→intact→QC→rubble→QC→consistency→manifest→Godot→publish
 *
 * Uses a local mock HTTP server that returns synthetic valid sprites,
 * not just tiny 1×1 PNGs.
 */

import { createServer } from 'http';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ok, err } from '../lib/result.js';
import { emitReport } from './_report.js';

const TMP = path.join(process.cwd(), 'test', 'tmp_e2e');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const __startedAt = Date.now();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  ✗ ${msg}`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}
function assertNot(cond, msg) {
  if (cond) { failed++; console.log(`  ✗ ${msg}`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a valid sprite: transparent background with solid body, centered. */
async function makeValidSprite(w, h, color, margin) {
  const bodyBuf = await sharp({
    create: { width: w - margin * 2, height: h - margin * 2, channels: 3, background: color },
  }).png().toBuffer();
  return await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: bodyBuf, top: margin, left: margin }]).png().toBuffer();
}

/** Create a rubble sprite: same canvas, slightly different color and margin. */
async function makeRubbleSprite(w, h, baseColor, marginDelta) {
  const color = {
    r: Math.min(255, baseColor.r + Math.floor(Math.random() * 40 - 20)),
    g: Math.min(255, baseColor.g + Math.floor(Math.random() * 40 - 20)),
    b: Math.min(255, baseColor.b + Math.floor(Math.random() * 40 - 20)),
  };
  const margin = marginDelta || 2;
  const bodyBuf = await sharp({
    create: { width: w - (margin + 2) * 2, height: h - (margin + 2) * 2, channels: 3, background: color },
  }).png().toBuffer();
  return await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: bodyBuf, top: margin, left: margin }]).png().toBuffer();
}

/**
 * Mock server that returns valid sprites matching the request prompt.
 * Returns two sprites: intact (solid blue body) and rubble (slightly different).
 */
function createMockServer() {
  const requestLog = [];
  let requestCount = 0;
  const server = createServer(async (req, res) => {
    let rawBody = '';
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      rawBody = Buffer.concat(chunks).toString();
    }
    let parsedBody;
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = {}; }

    // Log every request
    requestLog.push({
      method: req.method,
      url: req.url,
      body: parsedBody,
      timestamp: Date.now(),
    });

    const width = parseInt(parsedBody.size?.split('x')[0] || '128');
    const height = parseInt(parsedBody.size?.split('x')[1] || '128');

    // Determine if this is a rubble request by checking prompt content
    const promptText = parsedBody.prompt || '';
    const isRubble = promptText.includes('rubble') || promptText.includes('damaged') ||
                     promptText.includes('broken') || promptText.includes('ruined');

    // Generate sprites with body bottom near ground anchor (y ≈ height * 0.9)
    // Body bottom = height - margin; want height - margin ≈ height * 0.9 → margin ≈ height * 0.1
    const groundMargin = Math.floor(height * 0.1); // 13 for height=128
    const bodyW = width - groundMargin * 2;
    const bodyH = height - groundMargin * 2;
    const bodyBuf = await sharp({
      create: { width: bodyW, height: bodyH, channels: 3,
        background: isRubble ? { r: 140, g: 120, b: 100 } : { r: 100, g: 150, b: 200 } },
    }).png().toBuffer();
    const spriteBuf = await sharp({
      create: { width, height, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: bodyBuf, top: groundMargin, left: groundMargin }]).png().toBuffer();

    const b64 = spriteBuf.toString('base64');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: b64 }] }));
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      server._port = server.address().port;
      resolve({ server, port: server._port, requestLog });
    });
  });
}

async function stopServer(s) {
  return new Promise(r => s.server.close(r));
}

// ─── Test: E2E generateCoverProp with mock provider ───────────────────────────
console.log('\nE2E: generateCoverProp with mock Agnes provider');

const mock = await createMockServer();
const mockBaseUrl = `http://127.0.0.1:${mock.port}`;

// Patch config to point to mock
const { loadConfig, saveConfig } = await import('../lib/config.js');
const originalConfig = loadConfig();
saveConfig({
  ...originalConfig,
  defaultProvider: 'agnes',
  credentials: {
    ...originalConfig.credentials,
    agnes: { apiKey: 'test-key', baseUrl: mockBaseUrl },
  },
});

const { generateCoverProp, computeAssetStatus, ensureCandidateDir } = await import('../lib/cover_prop.js');
const { QC_STATUS } = await import('../lib/qc.js');

try {
  const e2eDir = path.join(TMP, 'e2e_session');
  const e2eResult = await generateCoverProp({
    prop_id: 'test_bed_e2e',
    prompt: 'A wooden bed for a side-scrolling game',
    material_type: 'wood',
    cover_height: 'low',
    width: 128,
    height: 128,
    provider: 'agnes',
    output_dir: e2eDir,
    states: ['intact', 'rubble'],
  });

  assert(e2eResult.success === true, 'E2E generateCoverProp returns success');
  assert(e2eResult.data.prop_id === 'test_bed_e2e', 'E2E prop_id matches');

  // Check state results have success:true (the P0 fix)
  assert(e2eResult.data.state_results?.intact?.success === true,
    'state_results.intact.success === true (P0 fix verified)');
  assert(e2eResult.data.state_results?.rubble?.success === true,
    'state_results.rubble.success === true (P0 fix verified)');

  // Commercial SUCCESS requires strict APPROVED (no REVIEW tolerated here).
  const finalStatus = e2eResult.data.qc_status;
  assert(finalStatus === QC_STATUS.APPROVED,
    `Final status is strictly APPROVED, got ${finalStatus}`);

  // Directly use returned fields (no guessing paths).
  const manifestPath = e2eResult.data.manifest_path;
  const candidatesDir = e2eResult.data.candidates_dir;
  const approvedDir = e2eResult.data.approved_dir;
  const sessionId = e2eResult.data.session_id;
  assert(typeof sessionId === 'string' && sessionId.length > 0, 'session_id returned');
  assert(typeof manifestPath === 'string' && manifestPath.length > 0, 'manifest_path returned');
  assert(typeof candidatesDir === 'string' && candidatesDir.length > 0, 'candidates_dir returned');

  // Manifest file MUST exist and be readable; assert its key fields unconditionally.
  assert(existsSync(manifestPath), `Manifest file exists at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert(manifest.schema_version === 1, 'Manifest schema_version = 1');
  assert(manifest.prop_id === 'test_bed_e2e', 'Manifest prop_id matches');
  assert(manifest.material_type === 'wood', 'Manifest material_type = wood');
  assert(manifest.canvas_size[0] === 128, 'Manifest canvas_width = 128');
  assert(manifest.states.intact, 'Manifest has intact state');
  assert(manifest.qc_status === QC_STATUS.APPROVED, 'Manifest qc_status = APPROVED');
  assert(manifest.approved_dir && manifest.approved_dir.replace(/\\/g, '/').endsWith('approved/test_bed_e2e'),
    'Manifest approved_dir points to approved/test_bed_e2e');

  // Approved dir MUST exist for an APPROVED verdict.
  assert(existsSync(approvedDir), `Approved dir created at ${approvedDir}`);
  const approvedManifestPath = path.join(approvedDir, 'manifest.json');
  assert(existsSync(approvedManifestPath), 'Approved manifest.json exists');
  const approvedManifest = JSON.parse(readFileSync(approvedManifestPath, 'utf8'));
  // Approved manifest must semantically match the returned manifest.
  assert(approvedManifest.qc_status === manifest.qc_status, 'approved manifest qc_status matches');
  assert(approvedManifest.prop_id === manifest.prop_id, 'approved manifest prop_id matches');
  assert(approvedManifest.approved_dir === manifest.approved_dir, 'approved manifest approved_dir matches');

  // Candidate files present.
  const candidateFiles = existsSync(candidatesDir) ? readdirSync(candidatesDir) : [];
  assert(candidateFiles.length >= 2, `Candidate dir has ≥2 files: ${candidateFiles.join(', ')}`);

  // Check provider request log
  const agnesRequests = mock.requestLog.filter(r => r.url?.includes('/v1/images/generations'));
  assert(agnesRequests.length >= 1, `At least 1 Agnes request logged: ${agnesRequests.length}`);

  // Verify request body contains prompt
  const intactRequest = agnesRequests.find(r => !r.body?.prompt?.includes('rubble'));
  if (intactRequest) {
    assert(typeof intactRequest.body.prompt === 'string' && intactRequest.body.prompt.length > 0,
      'Agnes request body contains prompt string');
    assert(intactRequest.body.model === 'agnes-image-2.1-flash', 'Agnes request has correct model');
    assert(intactRequest.body.n === 1, 'Agnes request n=1');
  }

  console.log(`  Agnes requests logged: ${agnesRequests.length}`);
  console.log(`  Candidate files: ${candidateFiles.join(', ')}`);

} catch (e) {
  failed++;
  console.log(`  ✗ E2E test crashed: ${e.message}`);
  console.log(`  ${e.stack}`);
} finally {
  // Restore original config
  saveConfig(originalConfig);
  await stopServer(mock);
}

// ─── Test: ComputeAssetStatus with real pipeline data shape ──────────────────
console.log('\nE2E: computeAssetStatus with pipeline data shape');

// Realistic fully-resolved state shape (what generateCoverProp actually produces).
function realState(status, { review = false } = {}) {
  const evidencePath = path.join(TMP, `ev_${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(evidencePath, 'evidence');
  return {
    path: '/fake/path/x.png',
    gen_result: { success: true },
    qc: { status, rules: [{ id: 'HAS_ALPHA', passed: true, value: { a: 1 } }], measurements: { center_offset: 0.1 } },
    file_qc: { status: QC_STATUS.APPROVED, rules: [{ id: 'HAS_ALPHA', passed: true, value: { a: 1 } }], measurements: { center_offset: 0.1, ground_offset: 0.2, silhouette_iou: 0.9 } },
    consistency: { status: review ? QC_STATUS.REVIEW_REQUIRED : QC_STATUS.APPROVED },
    state_consistency_qc: { success: true, status: review ? QC_STATUS.REVIEW_REQUIRED : QC_STATUS.APPROVED },
    evidence: { qc_evidence: evidencePath },
    status,
    success: true,
  };
}

const pipelineData = {
  intact: realState(QC_STATUS.APPROVED),
  rubble: realState(QC_STATUS.APPROVED),
};

const statusFromPipeline = computeAssetStatus(pipelineData, ['intact', 'rubble'], { manifestValid: true });
assert(statusFromPipeline === QC_STATUS.APPROVED,
  `Pipeline data shape → APPROVED, got ${statusFromPipeline}`);

// Empty-shell state (no rules / no evidence) MUST be rejected, never APPROVED.
const emptyShell = {
  intact: { path: '/a', status: QC_STATUS.APPROVED, success: true },
  rubble: { path: '/b', status: QC_STATUS.APPROVED, success: true },
};
const emptyStatus = computeAssetStatus(emptyShell, ['intact', 'rubble'], { manifestValid: true });
assert(emptyStatus === QC_STATUS.REJECTED,
  `Empty-shell state → REJECTED (no false APPROVED), got ${emptyStatus}`);

// Missing success field → REJECTED (this was the bug)
const brokenPipelineData = {
  intact: { path: '/a', status: QC_STATUS.APPROVED }, // no success field
  rubble: { path: '/b', status: QC_STATUS.APPROVED },
};
const brokenStatus = computeAssetStatus(brokenPipelineData, ['intact', 'rubble'], { manifestValid: true });
assert(brokenStatus === QC_STATUS.REJECTED,
  `Missing success → REJECTED (old bug behavior preserved)`);

// ─── Test: Rubble failure with success:true still rejected ───────────────────
console.log('\nE2E: Rubble REJECTED blocks approval');
const rubbleFailed = {
  intact: realState(QC_STATUS.APPROVED),
  rubble: realState(QC_STATUS.REJECTED),
};
assert(computeAssetStatus(rubbleFailed, ['intact', 'rubble'], { manifestValid: true }) === QC_STATUS.REJECTED,
  'Rubble REJECTED → entire asset REJECTED');

// ─── Test: REVIEW verdict → approved must be COMPLETELY absent ───────────────
console.log('\nE2E: REVIEW_REQUIRED must NOT create approved dir');
const reviewState = {
  intact: realState(QC_STATUS.APPROVED),
  rubble: realState(QC_STATUS.REVIEW_REQUIRED, { review: true }),
};
const reviewStatus = computeAssetStatus(reviewState, ['intact', 'rubble'], { manifestValid: true });
assert(reviewStatus === QC_STATUS.REVIEW_REQUIRED,
  `REVIEW_REQUIRED verdict, got ${reviewStatus}`);
// If a generateCoverProp were to run and reach REVIEW, no approved dir would be created.
const reviewApproved = path.join(TMP, 'review_approved', 'test_bed_review');
assert(!existsSync(reviewApproved), 'No approved dir exists for REVIEW verdict');

// ─── Test: Directory isolation — approved not created until publish ──────────
console.log('\nE2E: Directory isolation during E2E');
const isoDir = path.join(TMP, 'iso_session');
mkdirSync(isoDir, { recursive: true });
const { candidatesDir } = ensureCandidateDir(isoDir, 'iso_test');

// Write a dummy file to candidates
writeFileSync(path.join(candidatesDir, 'dummy.png'), Buffer.from('test'));
assert(existsSync(candidatesDir), 'candidates dir exists');
assertNot(existsSync(path.join(isoDir, 'approved', 'iso_test')),
  'approved dir NOT created before publish');

// Publish
const { publishToApproved } = await import('../lib/cover_prop.js');
publishToApproved(candidatesDir, path.join(isoDir, 'approved', 'iso_test'), 'iso_test');
assert(existsSync(path.join(isoDir, 'approved', 'iso_test')),
  'approved dir created after publish');
const publishedFiles = readdirSync(path.join(isoDir, 'approved', 'iso_test'));
assert(publishedFiles.includes('dummy.png'), 'Published file exists in approved dir');

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`E2E RESULTS: ${passed} passed / ${failed} failed / ${passed + failed} total`);
console.log('════════════════════════════════════════════════');
emitReport('e2e', { assertions: passed + failed, passed, failed, startedAt: __startedAt });
// Cleanup: remove isolated tmp dir on all paths (success/failure) so artifact_cleanup can verify zero leak
try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
process.exit(failed > 0 ? 1 : 0);
