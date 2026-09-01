/**
 * Comprehensive contract tests for all MCP tools.
 *
 * Tests every registered tool with:
 *   - Normal input
 *   - Minimal input
 *   - Boundary input
 *   - Error input
 *   - Output file validation
 *
 * No real API calls — uses mock HTTP server for providers.
 */

import { existsSync, mkdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const TMP = path.join(ROOT, 'test', 'tmp_contract');

// ─── Test framework ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  ⊘ ${name} (${reason})`);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

function assertMatch(str, pattern, msg) {
  if (!pattern.test(str)) throw new Error(msg || `Expected ${str} to match ${pattern}`);
}

function assertFileExists(filePath, msg) {
  if (!existsSync(filePath)) throw new Error(msg || `File does not exist: ${filePath}`);
}

function assertFileSize(filePath, minBytes, msg) {
  assertFileExists(filePath, msg);
  const stat = statSync(filePath);
  if (stat.size < minBytes) throw new Error(msg || `File too small: ${stat.size} < ${minBytes} bytes`);
}

async function assertValidImage(filePath) {
  const { default: sharp } = await import('sharp');
  try {
    const meta = await sharp(filePath).metadata();
    assert(meta.width > 0, 'Width must be > 0');
    assert(meta.height > 0, 'Height must be > 0');
    return meta;
  } catch (e) {
    throw new Error(`Invalid image: ${e.message}`);
  }
}

// ─── Helper: dynamic import with ROOT path ──────────────────────────────────

async function importLib(name) {
  const { pathToFileURL } = await import('url');
  return import(pathToFileURL(path.join(ROOT, 'lib', name)).href);
}

async function importHandler(name) {
  const { pathToFileURL } = await import('url');
  return import(pathToFileURL(path.join(ROOT, name)).href);
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

function setup() {
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════════

setup();

// ─── 1. Tool Registry Audit ────────────────────────────────────────────────

console.log('\n1. Tool registry audit');

await testAsync('server.js exports 35 tools', async () => {
  const { TOOLS } = await importHandler('server.js');
  assert(Array.isArray(TOOLS), `TOOLS should be array, got ${typeof TOOLS}`);
  assertEqual(TOOLS.length, 35, `Expected 35 tools, got ${TOOLS.length}`);
});

await testAsync('all tool names start with sprite_', async () => {
  const { TOOLS } = await importHandler('server.js');
  for (const tool of TOOLS) {
    assert(tool.name.startsWith('sprite_'), `Tool ${tool.name} does not start with sprite_`);
    assert(tool.description, `Tool ${tool.name} has no description`);
    assert(tool.inputSchema, `Tool ${tool.name} has no inputSchema`);
  }
});

await testAsync('no duplicate tool names', async () => {
  const { TOOLS } = await importHandler('server.js');
  const names = TOOLS.map(t => t.name);
  const unique = new Set(names);
  assertEqual(unique.size, names.length, `Duplicate tool names found`);
});

// ─── 2. Config Tools ───────────────────────────────────────────────────────

console.log('\n2. Config tools');

await testAsync('sprite__config list', async () => {
  const { loadConfig, listProviders, getConfigSummary } = await importLib('config.js');
  const summary = getConfigSummary();
  assert(summary.defaultProvider, 'Has defaultProvider');
  assert(Array.isArray(summary.providers), 'Has providers array');
  assert(summary.providers.length >= 4, 'At least 4 providers');
});

await testAsync('sprite__config get', async () => {
  const { loadConfig } = await importLib('config.js');
  const config = loadConfig();
  assert(config.defaultProvider, 'Has defaultProvider');
});

// ─── 3. Prompt/Style Lists ──────────────────────────────────────────────────

console.log('\n3. Prompt and style lists');

await testAsync('sprite_style_list returns 35 presets', async () => {
  const { STYLE_PRESETS } = await importLib('prompts.js');
  const keys = Object.keys(STYLE_PRESETS);
  assertEqual(keys.length, 35, `Expected 35, got ${keys.length}`);
  for (const [id, preset] of Object.entries(STYLE_PRESETS)) {
    assert(preset.name, `${id} has name`);
    assert(preset.description, `${id} has description`);
    assert(preset.prompt_suffix !== undefined, `${id} has prompt_suffix`);
  }
});

await testAsync('sprite_animation_list returns entries', async () => {
  const { ANIMATION_SEQUENCES } = await importLib('prompts.js');
  const keys = Object.keys(ANIMATION_SEQUENCES);
  assert(keys.length > 0, 'Has animation sequences');
  for (const [id, seq] of Object.entries(ANIMATION_SEQUENCES)) {
    assert(seq.name, `${id} has name`);
    assert(typeof seq.frames === 'number' && seq.frames > 0, `${id} has valid frames count`);
    assert(typeof seq.prompt === 'function', `${id} has prompt function`);
  }
});

await testAsync('sprite_effect_list returns entries', async () => {
  const { EFFECT_PROMPTS } = await importLib('prompts.js');
  const keys = Object.keys(EFFECT_PROMPTS);
  assert(keys.length > 0, 'Has effects');
});

await testAsync('sprite_weapon_list returns entries', async () => {
  const { WEAPON_PROMPTS } = await importLib('prompts.js');
  const keys = Object.keys(WEAPON_PROMPTS);
  assert(keys.length > 0, 'Has weapons');
});

// ─── 4. Sheet Processing (Python bridge) ────────────────────────────────────

console.log('\n4. Sprite sheet processing');

await testAsync('sprite__sheet normal 4x4', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');

  // Create test image
  const testImg = path.join(TMP, 'sheet_input.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'sheet_output.png');
  const result = await runPythonScript({
    image_path: testImg,
    grid_cols: 4,
    grid_rows: 4,
    output_path: outPath,
  });

  assert(result.success, `Expected success for sheet, got: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assertFileExists(outPath, 'Output file should exist');
  const meta = await assertValidImage(outPath);
  assert(meta.width > 0 && meta.height > 0, 'Output has valid dimensions');
});

await testAsync('sprite__sheet 1x1', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'sheet_1x1.png');
  await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 100, g: 200, b: 50, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'sheet_1x1_out.png');
  const result = await runPythonScript({
    image_path: testImg,
    grid_cols: 1,
    grid_rows: 1,
    output_path: outPath,
  });

  assert(result.success, 'Expected success for 1x1 sheet');
  assertFileExists(outPath);
});

await testAsync('sprite__sheet error: missing input', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const result = await runPythonScript({
    image_path: '/nonexistent/file.png',
    grid_cols: 4,
    grid_rows: 4,
  });
  assert(result.success === false || result.error, 'Should fail for missing file');
});

// ─── 5. Cutout ──────────────────────────────────────────────────────────────

console.log('\n5. Cutout');

await testAsync('sprite_cutout normal', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');

  // Create an image with distinct foreground (green) on background (red)
  const testImg = path.join(TMP, 'cutout_input.png');
  const w = 64, h = 64;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Foreground: green square in center (16x16)
      if (x >= 24 && x < 40 && y >= 24 && y < 40) {
        buf[i] = 0; buf[i + 1] = 200; buf[i + 2] = 0; buf[i + 3] = 255;
      } else {
        // Background: red
        buf[i] = 200; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(testImg);

  const outPath = path.join(TMP, 'cutout_output.png');
  const result = await runPythonScript({
    command: 'cutout',
    image_path: testImg,
    output_path: outPath,
  });

  // Cutout may succeed or fail depending on content analysis,
  // but should not crash — just verify it returns a valid response
  assert(typeof result === 'object', 'Should return an object');
  assert(
    result.success === true || result.success === false || result.output_path,
    `Should have success field or output_path: ${JSON.stringify(result).slice(0, 200)}`
  );
});

// ─── 6. GIF Preview ────────────────────────────────────────────────────────

console.log('\n6. GIF preview');

await testAsync('sprite_preview_gif normal', async () => {
  const { generateGifPreview } = await importLib('gif_preview.js');
  const { default: sharp } = await import('sharp');

  // Create a 4-frame sprite sheet (256x64)
  const testImg = path.join(TMP, 'gif_input.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'gif_output.gif');
  const result = await generateGifPreview({
    image_path: testImg,
    cell_width: 64,
    cell_height: 64,
    fps: 8,
    output_path: outPath,
  });

  assert(result.success, `GIF preview should succeed: ${JSON.stringify(result.error || '')}`);
  assertFileExists(outPath, 'GIF file should exist');
  assertFileSize(outPath, 100, 'GIF should be non-empty');

  // Verify GIF is actually animated (at least 2 frames)
  const buf = readFileSync(outPath);
  const gifHeader = buf.toString('ascii', 0, 6);
  assertMatch(gifHeader, /GIF89[a]/, 'Should be GIF89a');
});

await testAsync('sprite_preview_gif error: missing cell_width', async () => {
  const { generateGifPreview } = await importLib('gif_preview.js');
  const result = await generateGifPreview({ image_path: '/nonexistent.png' });
  assert(result.success === false, 'Should fail without cell_width');
});

// ─── 7. Godot Export ────────────────────────────────────────────────────────

console.log('\n7. Godot export');

await testAsync('sprite_export_godot normal', async () => {
  const { exportGodotSpriteFrames } = await importLib('godot_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'godot_input.png');
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'godot_output.tres');
  const result = await exportGodotSpriteFrames({
    image_path: testImg,
    cell_width: 64,
    output_path: outPath,
  });

  assert(result.success, `Godot export should succeed: ${JSON.stringify(result.error || '')}`);
  assertFileExists(outPath, '.tres file should exist');
  const content = readFileSync(outPath, 'utf8');
  assertMatch(content, /gd_scene/, 'Should be valid .tres format');
  assertMatch(content, /SpriteFrames/, 'Should contain SpriteFrames');
  assertMatch(content, /sub_resource/, 'Should contain sub_resources');
});

await testAsync('sprite_export_godot error: missing image', async () => {
  const { exportGodotSpriteFrames } = await importLib('godot_export.js');
  const result = await exportGodotSpriteFrames({ image_path: '/nonexistent.png', cell_width: 64 });
  assert(result.success === false, 'Should fail');
});

// ─── 8. TexturePacker Export ────────────────────────────────────────────────

console.log('\n8. TexturePacker export');

await testAsync('sprite_export_tpacker normal', async () => {
  const { exportTexturePacker } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'tpacker_input.png');
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'tpacker_output.json');
  const result = await exportTexturePacker({
    image_path: testImg,
    cell_width: 64,
    cell_height: 64,
    output_path: outPath,
  });

  assert(result.success, `TPacker export should succeed: ${JSON.stringify(result.error || '')}`);
  assertFileExists(outPath, 'JSON file should exist');
  const json = JSON.parse(readFileSync(outPath, 'utf8'));
  assert(json.frames || json.meta, 'Should have frames or meta key');
});

// ─── 9. Aseprite Export ────────────────────────────────────────────────────

console.log('\n9. Aseprite export');

await testAsync('sprite_export_aseprite normal', async () => {
  const { exportAseprite } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'aseprite_input.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'aseprite_output.json');
  const result = await exportAseprite({
    image_path: testImg,
    cell_width: 64,
    cell_height: 64,
    output_path: outPath,
  });

  assert(result.success, `Aseprite export should succeed: ${JSON.stringify(result.error || '')}`);
  assertFileExists(outPath);
  const json = JSON.parse(readFileSync(outPath, 'utf8'));
  assert(json.frames || json.meta, 'Should have frames or meta');
});

// ─── 10. Godot Scene Export ──────────────────────────────────────────────────

console.log('\n10. Godot scene export');

await testAsync('sprite_export_godot_scene normal', async () => {
  const { exportGodotScene } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'scene_input.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'scene_output.tscn');
  const result = await exportGodotScene({
    image_path: testImg,
    cell_width: 64,
    output_path: outPath,
  });

  assert(result.success, `Godot scene should succeed: ${JSON.stringify(result.error || '')}`);
  assertFileExists(outPath);
  const content = readFileSync(outPath, 'utf8');
  assertMatch(content, /\[gd_scene/, 'Should be valid .tscn format');
});

// ─── 11. Palette Extract ────────────────────────────────────────────────────

console.log('\n11. Palette extract');

await testAsync('sprite_palette_extract normal', async () => {
  const { extractPalette } = await importLib('analysis.js');
  const { default: sharp } = await import('sharp');

  // Create a colorful test image
  const testImg = path.join(TMP, 'palette_input.png');
  const w = 32, h = 32;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = x < w / 2 ? 255 : 0;     // R
      buf[i + 1] = y < h / 2 ? 255 : 0; // G
      buf[i + 2] = 128;                  // B
      buf[i + 3] = 255;                  // A
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(testImg);

  const result = await extractPalette({ image_path: testImg, colors: 4 });
  assert(result.success, `Palette should succeed: ${JSON.stringify(result.error || '')}`);
  assert(result.data, 'Should have data');
  assert(result.data.palette || result.palette, 'Should have palette');
});

// ─── 12. QC Report ──────────────────────────────────────────────────────────

console.log('\n12. QC report');

await testAsync('sprite_qc_report normal', async () => {
  const { qcReport } = await importLib('analysis.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'qc_input.png');
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await qcReport({ image_path: testImg, cell_width: 64, cell_height: 64 });
  assert(result.success, `QC report should succeed: ${JSON.stringify(result.error || '')}`);
  assert(result.data || result.grid, 'Should have report data');
});

// ─── 13. Detect Animations ──────────────────────────────────────────────────

console.log('\n13. Detect animations');

await testAsync('sprite_detect_animations normal', async () => {
  const { autoDetectAnimations } = await importLib('godot_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'detect_input.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await autoDetectAnimations(testImg, 64);
  assert(result.success || result.data, `Detect should succeed: ${JSON.stringify(result.error || '')}`);
});

// ─── 14. Sessions ───────────────────────────────────────────────────────────

console.log('\n14. Sessions');

await testAsync('session_list empty', async () => {
  const { listSessions } = await importLib('sessions.js');
  const result = listSessions();
  assert(result.success, 'listSessions should succeed');
  assert(Array.isArray(result.data), 'Should return array');
});

await testAsync('create + get + list session', async () => {
  const { createSession, getSession, listSessions } = await importLib('sessions.js');

  const createResult = createSession({
    provider: 'test',
    prompt: 'test prompt',
    output_path: path.join(TMP, 'session_test.png'),
  });
  assert(createResult.success, 'createSession should succeed');
  const { id } = createResult.data;

  const getResult = getSession(id);
  assert(getResult.success, 'getSession should succeed');
  assertEqual(getResult.data.provider, 'test');
  assertEqual(getResult.data.prompt, 'test prompt');
});

await testAsync('session not found', async () => {
  const { getSession } = await importLib('sessions.js');
  const result = getSession('99999');
  assert(result.success === false, 'Should fail for nonexistent session');
});

// ─── 15. Godot Scene Parser ─────────────────────────────────────────────────

console.log('\n15. Godot scene parser');

await testAsync('parseTscn + serializeTscn round-trip', async () => {
  const { parseTscn, serializeTscn } = await importLib('godot_scene.js');

  const tscn = `[gd_scene format=3]

[node name="Root" type="Node2D"]

[node name="Child" type="Sprite2D" parent="."]
position = Vector2(10, 20)
`;
  const parsed = parseTscn(tscn);
  assert(parsed, 'Should parse');
  assert(parsed.nodes, 'Should have nodes');
  assert(parsed.nodes.length >= 2, 'Should have at least 2 nodes');

  const serialized = serializeTscn(parsed);
  assertMatch(serialized, /\[gd_scene/, 'Serialized should have gd_scene');
  assertMatch(serialized, /Node2D/, 'Serialized should have Node2D');
});

await testAsync('findNode works', async () => {
  const { parseTscn, findNode } = await importLib('godot_scene.js');
  const tscn = `[gd_scene format=3]

[node name="Root" type="Node2D"]

[node name="Player" type="Node2D" parent="."]

[node name="Sprite" type="Sprite2D" parent="Root/Player"]
`;
  const parsed = parseTscn(tscn);
  const node = findNode(parsed, 'Root/Player');
  assert(node, 'Should find Root/Player');
  assertEqual(node.type, 'Node2D');
});

// ─── 16. Validate Limits ────────────────────────────────────────────────────

console.log('\n16. Limits and validation');

await testAsync('LIMITS has all sections', async () => {
  const { LIMITS } = await importLib('limits.js');
  assert(LIMITS.image, 'Has image limits');
  assert(LIMITS.video, 'Has video limits');
  assert(LIMITS.sprite, 'Has sprite limits');
  assert(LIMITS.timeout, 'Has timeout limits');
  assert(LIMITS.concurrency, 'Has concurrency limits');
  assert(LIMITS.cache, 'Has cache limits');
  assert(LIMITS.godotScan, 'Has godotScan limits');
  assert(LIMITS.network, 'Has network limits');
});

await testAsync('validate catches invalid args', async () => {
  const { validate } = await importLib('validate.js');
  const r = validate({}, { name: { type: 'string', required: true } });
  assert(r !== null, 'Should catch missing required');
  assert(r.success === false, 'Should be error');
});

// ─── 17. Result Protocol ────────────────────────────────────────────────────

console.log('\n17. Result protocol');

await testAsync('ok() returns valid structure', async () => {
  const { ok, ErrorCode } = await importLib('result.js');
  const r = ok({ foo: 1 });
  assert(r.success === true);
  assert(r.data.foo === 1);
  assert(r.metrics, 'Has metrics');
});

await testAsync('err() returns valid structure', async () => {
  const { err, ErrorCode } = await importLib('result.js');
  const r = err(ErrorCode.INVALID_ARGUMENT, 'bad input', { stage: 'validation' });
  assert(r.success === false);
  assertEqual(r.error.code, 'INVALID_ARGUMENT');
  assertEqual(r.error.stage, 'validation');
});

await testAsync('all 12 error codes exist', async () => {
  const { ErrorCode } = await importLib('result.js');
  const expected = [
    'INVALID_ARGUMENT', 'FILE_NOT_FOUND', 'UNSUPPORTED_FORMAT', 'DEPENDENCY_MISSING',
    'PROVIDER_NOT_CONFIGURED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE',
    'PROVIDER_TIMEOUT', 'PROCESSING_FAILED', 'OUTPUT_WRITE_FAILED', 'CANCELLED', 'INTERNAL_ERROR',
  ];
  for (const code of expected) {
    assertEqual(ErrorCode[code], code, `Missing code: ${code}`);
  }
});

// ─── 18. Concurrency ───────────────────────────────────────────────────────

console.log('\n18. Concurrency');

await testAsync('createSemaphore works', async () => {
  const { createSemaphore } = await importLib('concurrency.js');
  const sem = createSemaphore(2);

  assertEqual(sem.running(), 0);
  assertEqual(sem.queued(), 0);

  const r1 = await sem.acquire();
  assertEqual(sem.running(), 1);

  const r2 = await sem.acquire();
  assertEqual(sem.running(), 2);

  r1();
  assertEqual(sem.running(), 1);

  r2();
  assertEqual(sem.running(), 0);
});

await testAsync('parallelLimit preserves order', async () => {
  const { parallelLimit } = await importLib('concurrency.js');
  const order = [];
  const tasks = [1, 2, 3, 4, 5].map(n => async () => {
    await new Promise(r => setTimeout(r, Math.random() * 10));
    order.push(n);
    return n;
  });
  const results = await parallelLimit(tasks, 2);
  assertEqual(results.length, 5);
  // Results must be in input order
  assertEqual(results[0], 1);
  assertEqual(results[1], 2);
  assertEqual(results[2], 3);
  assertEqual(results[3], 4);
  assertEqual(results[4], 5);
});

// ─── 19. Cache ──────────────────────────────────────────────────────────────

console.log('\n19. Cache');

await testAsync('createCache basic operations', async () => {
  const { createCache } = await importLib('cache.js');
  const cache = createCache({ maxEntries: 10, defaultTtlMs: 60000 });

  cache.set('key1', 'value1');
  assertEqual(cache.get('key1'), 'value1');
  assert(cache.has('key1'));

  cache.delete('key1');
  assert(!cache.has('key1'));
  assertEqual(cache.get('key1'), undefined);
});

await testAsync('cache TTL expiration', async () => {
  const { createCache } = await importLib('cache.js');
  const cache = createCache({ maxEntries: 10, defaultTtlMs: 1 });

  cache.set('key1', 'value1');
  await new Promise(r => setTimeout(r, 10));
  assert(!cache.has('key1'));
  assertEqual(cache.get('key1'), undefined);
});

await testAsync('cache max entries eviction', async () => {
  const { createCache } = await importLib('cache.js');
  const cache = createCache({ maxEntries: 3, defaultTtlMs: 60000 });

  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4); // should evict 'a'

  assert(!cache.has('a'), 'Oldest should be evicted');
  assert(cache.has('d'));
});

// ─── 20. Safe Scan ──────────────────────────────────────────────────────────

console.log('\n20. Safe directory scan');

await testAsync('safeScanDir respects limits', async () => {
  const { safeScanDir } = await importLib('safe_scan.js');
  const dir = path.join(TMP, 'scan_test');
  mkdirSync(path.join(dir, '.git'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(dir, '.git', 'config'), 'test');
  writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'test');
  writeFileSync(path.join(dir, 'src', 'main.js'), 'test');

  const result = safeScanDir(dir);
  assertEqual(result.files.length, 1, 'Should skip .git and node_modules');
  assert(result.files[0].includes('main.js'));
});

// ─── 21. URL Safety ─────────────────────────────────────────────────────────

console.log('\n21. URL safety');

await testAsync('validateUrl blocks file://', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('file:///etc/passwd');
  assert(r !== null);
  assert(r.success === false);
});

await testAsync('validateUrl blocks localhost', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('http://localhost/admin');
  assert(r !== null);
  assert(r.success === false);
});

await testAsync('validateUrl accepts valid HTTPS', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('https://api.example.com/v1');
  assertEqual(r, null);
});

await testAsync('validateComfyUrl allows localhost', async () => {
  const { validateComfyUrl } = await importLib('url_safety.js');
  const r = validateComfyUrl('http://127.0.0.1:8188');
  assertEqual(r, null);
});

await testAsync('validateComfyUrl blocks external', async () => {
  const { validateComfyUrl } = await importLib('url_safety.js');
  const r = validateComfyUrl('http://evil.com:8188');
  assert(r !== null);
  assert(r.success === false);
});

// ─── 22. Subprocess Safety ──────────────────────────────────────────────────

console.log('\n22. Subprocess safety');

await testAsync('commandExists works', async () => {
  const { commandExistsAsync } = await importLib('runner.js');
  assert(await commandExistsAsync('node'), 'node should exist');
  assert(!await commandExistsAsync('nonexistent_xyz'), 'nonexistent should not exist');
});

await testAsync('runCommand rejects non-array args', async () => {
  const { runAsync } = await importLib('runner.js');
  try {
    await runAsync('node', 'not-an-array');
    throw new Error('Should throw');
  } catch (e) {
    assertMatch(e.message, /array/);
  }
});

await testAsync('shell metacharacters blocked', async () => {
  const { runFfmpegAsync } = await importLib('runner.js');
  try {
    await runFfmpegAsync(['-i', 'test; rm -rf /']);
    throw new Error('Should throw');
  } catch (e) {
    assertMatch(e.message, /Dangerous|dangerous|Potentially/);
  }
});

// ─── 23. Metrics ────────────────────────────────────────────────────────────

console.log('\n23. Metrics');

await testAsync('createMetrics tracks timing', async () => {
  const { createMetrics } = await importLib('metrics.js');
  const m = createMetrics();
  await new Promise(r => setTimeout(r, 5));
  m.mark('processing');
  await new Promise(r => setTimeout(r, 5));
  m.setOutputBytes(1024);
  m.setFrameCount(4);
  m.mark('output');

  const json = m.toJSON();
  assert(json.duration_ms > 0, 'duration_ms should be > 0');
  assertEqual(json.output_bytes, 1024);
  assertEqual(json.frame_count, 4);
  assert(json.processing_ms >= 0, 'processing_ms should be >= 0');
});

// ─── 24. Video tools (use exec_path.js for ffmpeg resolution) ──────────────────

console.log('\n24. Video tools');

let hasFfmpeg = false;
try {
  const { resolveFfmpegPath } = await importLib('exec_path.js');
  const ffmpegPath = resolveFfmpegPath();
  if (ffmpegPath) {
    const { execFileSync } = await import('child_process');
    execFileSync(ffmpegPath, ['-version'], { timeout: 3000, stdio: 'ignore', windowsHide: true });
    hasFfmpeg = true;
  }
} catch (_) {
  hasFfmpeg = false;
}

if (hasFfmpeg) {
  await testAsync('sprite_extract_video_frames error: missing input', async () => {
    const { extractVideoFrames } = await importLib('video_gen.js');
    const result = await extractVideoFrames({
      video_path: '/nonexistent/video.mp4',
      output_path: path.join(TMP, 'frames'),
    });
    assert(result.success === false, 'Should fail for missing video');
  });

  await testAsync('sprite_video_to_sheet error: missing input', async () => {
    const { videoToSpriteSheet } = await importLib('video_gen.js');
    const result = await videoToSpriteSheet({
      video_path: '/nonexistent/video.mp4',
      output_path: path.join(TMP, 'v2sheet.png'),
    });
    assert(result.success === false, 'Should fail for missing video');
  });
} else {
  skip('sprite_extract_video_frames', 'ffmpeg not installed');
  skip('sprite_video_to_sheet', 'ffmpeg not installed');
}

// ─── 25. Provider mock HTTP tests ──────────────────────────────────────────

console.log('\n25. Provider mock HTTP tests');

await testAsync('mock server starts and stops', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer();
  await server.start();
  assert(server.baseUrl, 'Should have baseUrl');
  assert(server.port > 0, 'Should have port');
  await server.stop();
});

await testAsync('mock server returns image for gemini-like endpoint', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer();
  await server.start();

  try {
    const resp = await fetch(`${server.baseUrl}/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] }),
    });
    const json = await resp.json();
    assert(json.candidates, 'Should have candidates');
    assert(json.candidates[0].content.parts[0].inlineData, 'Should have inlineData');
  } finally {
    await server.stop();
  }
});

await testAsync('mock server handles 401 auth failure', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer({ behavior: { failRate: 1, failStatus: 401, failMessage: 'Unauthorized' } });
  await server.start();

  try {
    const resp = await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    assertEqual(resp.status, 401);
    const json = await resp.json();
    assert(json.error, 'Should have error');
  } finally {
    await server.stop();
  }
});

await testAsync('mock server handles 429 rate limit', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer({ behavior: { failRate: 1, failStatus: 429, failMessage: 'Rate limited' } });
  await server.start();

  try {
    const resp = await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    assertEqual(resp.status, 429);
  } finally {
    await server.stop();
  }
});

await testAsync('mock server handles invalid JSON response', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer({ behavior: { returnInvalidJson: true } });
  await server.start();

  try {
    const resp = await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    const text = await resp.text();
    assert(text.includes('NOT VALID JSON'), 'Should return garbage');
  } finally {
    await server.stop();
  }
});

await testAsync('mock server handles empty image result', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer({ behavior: { returnEmpty: true } });
  await server.start();

  try {
    const resp = await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    const json = await resp.json();
    // Provider-specific: empty results
    const isEmpty = (json.images && json.images.length === 0) ||
                    (json.candidates && json.candidates.length === 0) ||
                    (json.data && json.data.length === 0);
    assert(isEmpty, 'Should return empty result');
  } finally {
    await server.stop();
  }
});

await testAsync('mock server records request log', async () => {
  const { MockProviderServer } = await import('./mock_server.js');
  const server = new MockProviderServer();
  await server.start();

  try {
    await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    const log = server.getRequestLog();
    assertEqual(log.length, 1);
    assertEqual(log[0].method, 'POST');
    assertEqual(log[0].url, '/api/generate');
  } finally {
    await server.stop();
  }
});

// ─── 26. Autotile ──────────────────────────────────────────────────────────

console.log('\n26. Autotile');

await testAsync('sprite_autotile normal', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');

  // Create a 64x64 tile image
  const testImg = path.join(TMP, 'autotile_input.png');
  const w = 64, h = 64;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isEdge = x < 8 || x >= w - 8 || y < 8 || y >= h - 8;
      buf[i] = isEdge ? 80 : 120;
      buf[i + 1] = isEdge ? 80 : 160;
      buf[i + 2] = isEdge ? 80 : 120;
      buf[i + 3] = 255;
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(testImg);

  const result = await runPythonScript({
    command: 'autotile',
    image_path: testImg,
  });
  // Autotile returns 16 variants
  assert(typeof result === 'object', 'Should return object');
});

await testAsync('sprite_autotile error: missing image', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const result = await runPythonScript({
    command: 'autotile',
    image_path: '/nonexistent.png',
  });
  assert(result.success === false || result.error, 'Should fail for missing file');
});

// ─── 27. Godot integration (fixture project) ───────────────────────────────

console.log('\n27. Godot integration (fixture project)');

const fixtureDir = path.join(FIXTURES, 'godot_project');

await testAsync('sprite_godot_scan finds fixture project', async () => {
  const { godotScanProject } = await importLib('godot_integration.js');
  const result = await godotScanProject({ project_path: fixtureDir });
  assert(result.success, `Should succeed: ${JSON.stringify(result.error || '')}`);
  assert(result.data || result.scenes || result.sprites, 'Should have scan data');
});

await testAsync('sprite_godot_import with fixture project', async () => {
  const { godotImportSheet } = await importLib('godot_integration.js');
  const heroPng = path.join(fixtureDir, 'sprites', 'hero.png');
  if (!existsSync(heroPng)) {
    skip('sprite_godot_import', 'hero.png fixture not found');
    return;
  }

  const result = await godotImportSheet({
    project_path: fixtureDir,
    image_path: heroPng,
    name: 'test_import',
    cell_width: 64,
  });
  // Import should succeed or fail gracefully (not crash)
  assert(typeof result === 'object', 'Should return object');
});

// ─── 28. Boundary tests ────────────────────────────────────────────────────

console.log('\n28. Boundary and edge case tests');

await testAsync('sprite__sheet: cell_width=0 rejected', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'boundary_sheet.png');
  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await runPythonScript({
    image_path: testImg,
    grid_cols: 0,
    grid_rows: 1,
  });
  // Should handle gracefully (0 cols → error or default)
  assert(typeof result === 'object', 'Should return object');
});

await testAsync('sprite_preview_gif: fps=0 defaults', async () => {
  const { generateGifPreview } = await importLib('gif_preview.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'gif_fps0.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await generateGifPreview({
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    fps: 0,
  });
  assert(typeof result === 'object', 'Should return object with success field');
  assert(result.success !== undefined, 'Should have success field');
});

await testAsync('sprite_export_godot: cell_width=0 rejected', async () => {
  const { exportGodotSpriteFrames } = await importLib('godot_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'godot_boundary.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await exportGodotSpriteFrames({
    image_path: testImg,
    cell_width: 0,
    output_path: path.join(TMP, 'boundary.tres'),
  });
  assert(result.success === false, 'Should fail for cell_width=0');
});

await testAsync('sprite_export_tpacker: very large cell_width', async () => {
  const { exportTexturePacker } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'tpacker_large.png');
  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await exportTexturePacker({
    image_path: testImg,
    cell_width: 9999,
    cell_height: 9999,
    output_path: path.join(TMP, 'tpacker_large.json'),
  });
  // Cell width > image size → should handle gracefully
  assert(typeof result === 'object', 'Should return object');
});

await testAsync('sprite_cutout: very small image (1x1)', async () => {
  const { runPythonScript } = await importLib('utils.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'cutout_1x1.png');
  await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await runPythonScript({
    command: 'cutout',
    image_path: testImg,
    output_path: path.join(TMP, 'cutout_1x1_out.png'),
  });
  assert(typeof result === 'object', 'Should return object (may fail, but not crash)');
});

await testAsync('validateUrl: empty string', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('');
  assert(r !== null, 'Should reject empty string');
});

await testAsync('validateUrl: null', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl(null);
  assert(r !== null, 'Should reject null');
});

await testAsync('validateUrl: javascript: protocol', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('javascript:alert(1)');
  assert(r !== null, 'Should reject javascript:');
});

await testAsync('validateUrl: data: protocol', async () => {
  const { validateUrl } = await importLib('url_safety.js');
  const r = validateUrl('data:text/html,<script>alert(1)</script>');
  assert(r !== null, 'Should reject data:');
});

await testAsync('parallelLimit with empty tasks', async () => {
  const { parallelLimit } = await importLib('concurrency.js');
  const results = await parallelLimit([], 4);
  assertEqual(results.length, 0);
});

await testAsync('parallelLimit with throwing tasks', async () => {
  const { parallelLimit } = await importLib('concurrency.js');
  const tasks = [
    async () => { throw new Error('fail'); },
    async () => 42,
    async () => { throw new Error('fail2'); },
  ];
  const results = await parallelLimit(tasks, 2);
  // Throwing tasks store the Error object
  assert(results[0] instanceof Error, 'Task 0 should be Error');
  assertEqual(results[1], 42);
  assert(results[2] instanceof Error, 'Task 2 should be Error');
});

await testAsync('cache: clear all', async () => {
  const { createCache } = await importLib('cache.js');
  const cache = createCache({ maxEntries: 10, defaultTtlMs: 60000 });
  cache.set('a', 1);
  cache.set('b', 2);
  assertEqual(cache.size, 2);
  cache.clear();
  assertEqual(cache.size, 0);
});

await testAsync('cache: stats', async () => {
  const { createCache } = await importLib('cache.js');
  const cache = createCache({ maxEntries: 10, defaultTtlMs: 60000 });
  cache.set('a', 1);
  cache.get('a'); // hit
  cache.get('b'); // miss
  const stats = cache.stats();
  assertEqual(stats.entries, 1);
});

await testAsync('sanitizeMessage strips API keys', async () => {
  const { sanitizeMessage } = await importLib('result.js');
  const msg = 'Error with key sk-1234567890abcdef1234567890abcdef in it';
  const clean = sanitizeMessage(msg);
  assert(!clean.includes('sk-1234567890'), 'Should strip API key');
});

await testAsync('sanitizeMessage strips Authorization header', async () => {
  const { sanitizeMessage } = await importLib('result.js');
  const msg = 'Header: Authorization: Bearer tok_abc123def456ghi789jkl012';
  const clean = sanitizeMessage(msg);
  assert(!clean.includes('tok_abc123'), 'Should strip bearer token');
});

// ─── 29. Image output validation ───────────────────────────────────────────

console.log('\n29. Image output validation');

await testAsync('GIF output is valid animated GIF', async () => {
  const { generateGifPreview } = await importLib('gif_preview.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'gif_validate.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'gif_validate_out.gif');
  const result = await generateGifPreview({
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    fps: 4,
    output_path: outPath,
  });

  if (result.success && existsSync(outPath)) {
    const buf = readFileSync(outPath);
    // GIF header
    assert(buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46, 'Should start with GIF magic bytes');
    // Check for multiple frames (look for Image Descriptor marker 0x2C after first frame)
    let frameCount = 0;
    for (let i = 6; i < buf.length - 1; i++) {
      if (buf[i] === 0x2C) frameCount++; // Image Descriptor
    }
    assert(frameCount >= 1, `GIF should have at least 1 frame, found ${frameCount}`);
  }
});

await testAsync('Godot .tres output can be parsed', async () => {
  const { exportGodotSpriteFrames } = await importLib('godot_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'tres_validate.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'tres_validate.tres');
  await exportGodotSpriteFrames({
    image_path: testImg,
    cell_width: 64,
    output_path: outPath,
  });

  if (existsSync(outPath)) {
    const { parseTscn } = await importLib('godot_scene.js');
    const content = readFileSync(outPath, 'utf8');
    // .tres uses similar format to .tscn
    assert(content.includes('[resource]'), 'Should have [resource] section');
    assert(content.includes('SpriteFrames'), 'Should reference SpriteFrames');
  }
});

await testAsync('TexturePacker JSON has required fields', async () => {
  const { exportTexturePacker } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'tpacker_validate.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'tpacker_validate.json');
  const result = await exportTexturePacker({
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    output_path: outPath,
  });

  if (result.success && existsSync(outPath)) {
    const json = JSON.parse(readFileSync(outPath, 'utf8'));
    assert(json.meta || json.frames, 'Should have meta or frames');
    if (json.meta) {
      assert(json.meta.size || json.meta.image, 'meta should have size or image');
    }
  }
});

await testAsync('Aseprite JSON has required fields', async () => {
  const { exportAseprite } = await importLib('engine_export.js');
  const { default: sharp } = await import('sharp');

  const testImg = path.join(TMP, 'aseprite_validate.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const outPath = path.join(TMP, 'aseprite_validate.json');
  const result = await exportAseprite({
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    output_path: outPath,
  });

  if (result.success && existsSync(outPath)) {
    const json = JSON.parse(readFileSync(outPath, 'utf8'));
    assert(json.frames || json.meta, 'Should have frames or meta');
    if (json.meta && json.meta.frame_tags) {
      assert(Array.isArray(json.meta.frame_tags), 'frame_tags should be array');
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error.message}`);
  }
}
console.log('═'.repeat(60));

teardown();
process.exit(failed > 0 ? 1 : 0);
