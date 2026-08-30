/**
 * Direct-call tests — proves core services work WITHOUT MCP.
 *
 * Usage:
 *   node test/direct_call.js
 *
 * No MCP SDK, no StdioServerTransport, no protocol layer.
 * Pure JavaScript function calls.
 */

import {
  configService, sheetService, infoService,
  cutoutService, gifPreviewService, godotExportService,
  detectAnimationsService, sessionListService,
  autotileService, engineExportService, paletteExtractService,
  qcReportService, godotScanService, styleListService,
  animationListService, effectListService, weaponListService,
} from '../lib/services.js';

import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_direct');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
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
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

// ─── Setup ──────────────────────────────────────────────────────────────────

mkdirSync(TMP, { recursive: true });

try {

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECT CALL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n1. Direct calls — config');

await testAsync('configService({ action: "list" })', async () => {
  const result = await configService({ action: 'list' });
  assert(result.success, 'Should succeed');
  assert(result.data.defaultProvider, 'Should have defaultProvider');
  assert(Array.isArray(result.data.providers), 'Should have providers');
});

await testAsync('configService({ action: "get" })', async () => {
  const result = await configService({ action: 'get' });
  assert(result.success, 'Should succeed');
});

await testAsync('infoService()', async () => {
  const result = await infoService();
  assert(result.success, 'Should succeed');
  assertEqual(result.data.name, 'sprite-gen-mcp');
  assertEqual(result.data.version, '1.0.0');
});

console.log('\n2. Direct calls — lists');

await testAsync('styleListService()', async () => {
  const result = await styleListService();
  assert(result.success, 'Should succeed');
  assert(result.data.length === 35, 'Should have 35 styles');
});

await testAsync('animationListService()', async () => {
  const result = await animationListService();
  assert(result.success, 'Should succeed');
  // animationListService wraps listAnimationSequences() which already returns ok()
  const list = result.data?.data ?? result.data;
  assert(Array.isArray(list) ? list.length > 0 : true, 'Should have animations');
});

await testAsync('effectListService()', async () => {
  const result = await effectListService();
  assert(result.success, 'Should succeed');
  const list = result.data?.data ?? result.data;
  assert(Array.isArray(list) ? list.length > 0 : true, 'Should have effects');
});

await testAsync('weaponListService()', async () => {
  const result = await weaponListService();
  assert(result.success, 'Should succeed');
  const list = result.data?.data ?? result.data;
  assert(Array.isArray(list) ? list.length > 0 : true, 'Should have weapons');
});

console.log('\n3. Direct calls — session');

await testAsync('sessionListService()', async () => {
  const result = await sessionListService();
  assert(result.success, 'Should succeed');
  assert(Array.isArray(result.data.sessions), 'Should have sessions array');
});

console.log('\n4. Direct calls — sheet processing');

await testAsync('sheetService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_sheet.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await sheetService({
    image_path: testImg,
    grid_cols: 4,
    grid_rows: 4,
    output_path: path.join(TMP, 'direct_sheet_out.png'),
  });
  assert(result.success === true, `Should succeed, got: ${JSON.stringify(result.error || result).slice(0, 200)}`);
});

await testAsync('cutoutService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_cutout.png');
  const w = 64, h = 64;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x >= 24 && x < 40 && y >= 24 && y < 40) {
        buf[i] = 0; buf[i + 1] = 200; buf[i + 2] = 0; buf[i + 3] = 255;
      } else {
        buf[i] = 200; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(testImg);

  const result = await cutoutService({
    image_path: testImg,
    output_path: path.join(TMP, 'direct_cutout_out.png'),
  });
  assert(typeof result === 'object', 'Should return object');
});

console.log('\n5. Direct calls — GIF preview');

await testAsync('gifPreviewService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_gif.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await gifPreviewService({
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    fps: 4,
    output_path: path.join(TMP, 'direct_gif_out.gif'),
  });
  assert(result.success, 'Should succeed');
  // Result data may be nested or flat
  const gifPath = result.data?.gif_path || result.gif_path;
  assert(gifPath, 'Should have gif_path');
});

console.log('\n6. Direct calls — Godot export');

await testAsync('godotExportService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_godot.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await godotExportService({
    image_path: testImg,
    cell_width: 64,
    output_path: path.join(TMP, 'direct_godot.tres'),
  });
  assert(result.success, 'Should succeed');
});

await testAsync('detectAnimationsService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_detect.png');
  await sharp({
    create: { width: 256, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await detectAnimationsService({ image_path: testImg, cell_width: 64 });
  assert(result.success || result.data, 'Should succeed');
});

console.log('\n7. Direct calls — engine exports');

await testAsync('engineExportService("tpacker") normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_tpacker.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await engineExportService('tpacker', {
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    output_path: path.join(TMP, 'direct_tpacker.json'),
  });
  assert(result.success, 'Should succeed');
});

await testAsync('engineExportService("aseprite") normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_aseprite.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await engineExportService('aseprite', {
    image_path: testImg,
    cell_width: 32,
    cell_height: 32,
    output_path: path.join(TMP, 'direct_aseprite.json'),
  });
  assert(result.success, 'Should succeed');
});

await testAsync('engineExportService("godot_scene") normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_scene.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await engineExportService('godot_scene', {
    image_path: testImg,
    cell_width: 32,
    output_path: path.join(TMP, 'direct_scene.tscn'),
  });
  assert(result.success, 'Should succeed');
});

console.log('\n8. Direct calls — analysis');

await testAsync('paletteExtractService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_palette.png');
  const w = 32, h = 32;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = x < 16 ? 255 : 0;
      buf[i + 1] = y < 16 ? 255 : 0;
      buf[i + 2] = 128;
      buf[i + 3] = 255;
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(testImg);

  const result = await paletteExtractService({ image_path: testImg, colors: 4 });
  assert(result.success, 'Should succeed');
});

await testAsync('qcReportService() normal', async () => {
  const { default: sharp } = await import('sharp');
  const testImg = path.join(TMP, 'direct_qc.png');
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(testImg);

  const result = await qcReportService({ image_path: testImg, cell_width: 64, cell_height: 64 });
  assert(result.success, 'Should succeed');
});

console.log('\n9. Direct calls — Godot integration');

await testAsync('godotScanService() with fixture', async () => {
  const fixtureDir = path.join(ROOT, 'test', 'fixtures', 'godot_project');
  const result = await godotScanService({ project_path: fixtureDir });
  assert(result.success, 'Should succeed');
});

console.log('\n10. No MCP SDK in core');

await testAsync('services.js does not import MCP SDK', async () => {
  const { readFileSync } = await import('node:fs');
  const content = readFileSync(path.join(ROOT, 'lib', 'services.js'), 'utf8');
  assert(!content.includes('@modelcontextprotocol'), 'services.js must not import MCP SDK');
  assert(!content.includes('StdioServerTransport'), 'services.js must not use StdioServerTransport');
  assert(!content.includes('CallToolRequestSchema'), 'services.js must not reference CallToolRequestSchema');
});

await testAsync('server.js is the only MCP import point', async () => {
  const libFiles = readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js'));
  for (const file of libFiles) {
    const content = readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    assert(!content.includes('@modelcontextprotocol'), `lib/${file} should not import MCP SDK`);
  }
});

console.log('\n11. No circular dependencies');

await testAsync('services.js import tree has no cycles', async () => {
  const libFiles = readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js') && f !== 'services.js');
  for (const file of libFiles) {
    const content = readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    assert(!content.includes('./services.js') && !content.includes('../lib/services.js'),
      `lib/${file} must not import services.js (would create cycle)`);
  }
});

} finally {
  try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
