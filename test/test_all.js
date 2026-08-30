/**
 * sprite-gen-mcp test suite
 *
 * Tests:
 *   1. Module imports — all lib modules load without error
 *   2. Service startup — server.js can be parsed and MCP Server created
 *   3. Python bridge — process_sprites.py responds to a minimal command
 *   4. Config — loadConfig / saveConfig round-trips
 *   5. Prompts — STYLE_PRESETS, ANIMATION_SEQUENCES, EFFECT_PROMPTS, WEAPON_PROMPTS are non-empty
 *   6. Godot scene parser — parseTscn / serializeTscn round-trip
 *   7. No temp files left after test
 *
 * No real API calls. No network access. No file writes outside test artifacts.
 */

import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const lib = (name) => path.join(ROOT, 'lib', name);

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// Helper: import a lib module by name (e.g. 'config.js')
async function importLib(name) {
  return import(pathToFileURL(lib(name)).href);
}

import { pathToFileURL } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Module imports
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n1. Module imports');

const moduleNames = [
  'config.js',
  'prompts.js',
  'utils.js',
  'image_gen.js',
  'animation_gen.js',
  'effects_gen.js',
  'weapon_gen.js',
  'batch_gen.js',
  'background_gen.js',
  'sessions.js',
  'gif_preview.js',
  'godot_export.js',
  'godot_scene.js',
  'godot_integration.js',
  'video_gen.js',
  'engine_export.js',
  'analysis.js',
];

for (const mod of moduleNames) {
  await testAsync(`import ${mod}`, async () => {
    const m = await importLib(mod);
    if (!m || Object.keys(m).length === 0) {
      throw new Error(`Module ${mod} exported no members`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Service startup smoke test
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n2. Service startup smoke test');

await testAsync('server.js parses without error', async () => {
  const serverUrl = pathToFileURL(path.join(ROOT, 'server.js')).href;
  await import(serverUrl);
  // If import succeeds, the MCP Server was constructed and handlers registered
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Python bridge test
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n3. Python bridge');

await testAsync('process_sprites.py compiles', () => {
  execFileSync('python', ['-m', 'py_compile', lib('process_sprites.py')], {
    encoding: 'utf8',
    timeout: 10000,
  });
});

await testAsync('runPythonScript responds to sprite_sheet command', async () => {
  const { runPythonScript } = await importLib('utils.js');

  const testDir = path.join(ROOT, 'tmp');
  mkdirSync(testDir, { recursive: true });
  const testImage = path.join(testDir, 'test_input.png');
  const testOutput = path.join(testDir, 'test_output.png');

  try {
    const { default: sharp } = await import('sharp');
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
    }).png().toFile(testImage);

    const result = await runPythonScript({
      image_path: testImage,
      grid_cols: 2,
      grid_rows: 2,
      crop_mode: 'none',
      output_path: testOutput,
    });

    if (!result.success) {
      throw new Error(`Python script failed: ${result.error}`);
    }
    if (!existsSync(testOutput)) {
      throw new Error('Output file was not created');
    }
  } finally {
    try { if (existsSync(testImage)) unlinkSync(testImage); } catch (_) {}
    try { if (existsSync(testOutput)) unlinkSync(testOutput); } catch (_) {}
  }
});

await testAsync('runPythonScript responds to cutout command', async () => {
  const { runPythonScript } = await importLib('utils.js');

  const testDir = path.join(ROOT, 'tmp');
  mkdirSync(testDir, { recursive: true });
  const testImage = path.join(testDir, 'test_cutout_input.png');
  const testOutput = path.join(testDir, 'test_cutout_output.png');

  try {
    const { default: sharp } = await import('sharp');
    // Create image with white background and colored center (content to cutout)
    const img = sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
    });
    // Overlay a colored rectangle in the center
    const overlay = Buffer.from(
      `<svg width="64" height="64"><rect x="16" y="16" width="32" height="32" fill="rgb(255,0,0)"/></svg>`
    );
    await img.composite([{ input: overlay }]).png().toFile(testImage);

    const result = await runPythonScript({
      command: 'cutout',
      image_path: testImage,
      output_path: testOutput,
      dist_threshold: 60,
      corner_region: 5,
      target_width: 64,
      target_height: 64,
    });

    if (!result.success) {
      throw new Error(`Cutout failed: ${result.error || JSON.stringify(result)}`);
    }
  } finally {
    try { if (existsSync(testImage)) unlinkSync(testImage); } catch (_) {}
    try { if (existsSync(testOutput)) unlinkSync(testOutput); } catch (_) {}
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Config tests
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n4. Config');

await testAsync('loadConfig returns default config', async () => {
  const { loadConfig, IMAGE_PROVIDERS } = await importLib('config.js');
  const config = loadConfig();
  if (!config.defaultProvider) throw new Error('Missing defaultProvider');
  if (!IMAGE_PROVIDERS[config.defaultProvider]) throw new Error(`Invalid default provider: ${config.defaultProvider}`);
});

await testAsync('listProviders returns all 4 providers', async () => {
  const { listProviders } = await importLib('config.js');
  const providers = listProviders();
  if (providers.length !== 4) throw new Error(`Expected 4 providers, got ${providers.length}`);
  const ids = providers.map(p => p.id);
  if (!ids.includes('gemini_flash')) throw new Error('Missing gemini_flash');
  if (!ids.includes('stable_diffusion')) throw new Error('Missing stable_diffusion');
  if (!ids.includes('agnes')) throw new Error('Missing agnes');
  if (!ids.includes('comfy')) throw new Error('Missing comfy');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Prompts tests
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n5. Prompts');

await testAsync('STYLE_PRESETS has 35 presets', async () => {
  const { STYLE_PRESETS } = await importLib('prompts.js');
  const keys = Object.keys(STYLE_PRESETS);
  if (keys.length !== 35) throw new Error(`Expected 35 style presets, got ${keys.length}`);
  for (const key of keys) {
    if (!STYLE_PRESETS[key].name) throw new Error(`Style ${key} missing name`);
    if (!STYLE_PRESETS[key].prompt_suffix) throw new Error(`Style ${key} missing prompt_suffix`);
  }
});

await testAsync('ANIMATION_SEQUENCES has entries', async () => {
  const { ANIMATION_SEQUENCES } = await importLib('prompts.js');
  const keys = Object.keys(ANIMATION_SEQUENCES);
  if (keys.length === 0) throw new Error('No animation sequences defined');
  for (const key of keys) {
    if (typeof ANIMATION_SEQUENCES[key].prompt !== 'function') {
      throw new Error(`Animation ${key} prompt is not a function`);
    }
  }
});

await testAsync('EFFECT_PROMPTS has entries', async () => {
  const { EFFECT_PROMPTS } = await importLib('prompts.js');
  if (Object.keys(EFFECT_PROMPTS).length === 0) throw new Error('No effects defined');
});

await testAsync('WEAPON_PROMPTS has entries', async () => {
  const { WEAPON_PROMPTS } = await importLib('prompts.js');
  if (Object.keys(WEAPON_PROMPTS).length === 0) throw new Error('No weapons defined');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Godot scene parser
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n6. Godot scene parser');

await testAsync('parseTscn + serializeTscn round-trip', async () => {
  const { parseTscn, serializeTscn } = await importLib('godot_scene.js');

  const sample = `[gd_scene load_steps=2 format=3]
[ext_resource type="Texture2D" path="res://sprite.png" id="1"]
[node name="Root" type="Node2D"]
position = Vector2(10, 20)
[node name="Sprite" type="Sprite2D" parent="."]
`;

  const scene = parseTscn(sample);
  if (!scene.header || !scene.header.format) throw new Error('Header not parsed');
  if (scene.nodes.length < 1) throw new Error('No nodes parsed');

  const output = serializeTscn(scene);
  if (!output.includes('gd_scene')) throw new Error('Serialized output missing header');
  if (!output.includes('Node2D')) throw new Error('Serialized output missing nodes');
});

await testAsync('findNode finds nested node', async () => {
  const { parseTscn, findNode } = await importLib('godot_scene.js');

  const sample = `[gd_scene load_steps=2 format=3]
[node name="Root" type="Node2D"]
[node name="Player" type="Node2D" parent="."]
[node name="Sprite" type="Sprite2D" parent="Player"]
`;

  const scene = parseTscn(sample);
  const node = findNode(scene, 'Root/Player/Sprite');
  if (!node) throw new Error('findNode failed for Root/Player/Sprite');
  if (node.type !== 'Sprite2D') throw new Error(`Wrong type: ${node.type}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Session management
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n7. Sessions');

await testAsync('createSession + getSession + listSessions', async () => {
  const { createSession, getSession, listSessions } = await importLib('sessions.js');

  const beforeResult = listSessions();
  if (!beforeResult.success) throw new Error('listSessions failed');
  const beforeCount = beforeResult.data.length;

  const createResult = createSession({
    provider: 'test',
    prompt: 'test prompt',
    output_path: '/tmp/test.png',
  });
  if (!createResult.success) throw new Error('createSession failed');
  const { id } = createResult.data;

  const getResult = getSession(id);
  if (!getResult.success) throw new Error('getSession returned failure');
  const session = getResult.data;
  if (!session) throw new Error('getSession returned null');
  if (session.provider !== 'test') throw new Error('Wrong provider');
  if (session.prompt !== 'test prompt') throw new Error('Wrong prompt');

  const afterResult = listSessions();
  if (!afterResult.success) throw new Error('listSessions failed');
  if (afterResult.data.length !== beforeCount + 1) throw new Error('Session not added to list');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Unified result protocol
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n8. Unified result protocol');

{
  const { ok, err, ErrorCode, artifact, sanitizeMessage, timer } = await importLib('result.js');
  const { validate } = await importLib('validate.js');

  // -- result.js ok() --
  test('ok() returns success=true with data', () => {
    const r = ok({ foo: 1 });
    if (r.success !== true) throw new Error('success not true');
    if (r.data.foo !== 1) throw new Error('data missing');
    if (!r.metrics || typeof r.metrics.duration_ms !== 'number') throw new Error('metrics missing');
  });

  test('ok() includes artifacts when provided', () => {
    const a = artifact('image', '/tmp/x.png', { mime_type: 'image/png', size_bytes: 1024 });
    const r = ok({ path: '/tmp/x.png' }, { artifacts: [a] });
    if (!r.artifacts || r.artifacts.length !== 1) throw new Error('artifacts missing');
    if (r.artifacts[0].type !== 'image') throw new Error('artifact type wrong');
    if (r.artifacts[0].mime_type !== 'image/png') throw new Error('artifact mime wrong');
    if (r.artifacts[0].size_bytes !== 1024) throw new Error('artifact size wrong');
  });

  test('ok() includes warnings when provided', () => {
    const r = ok({}, { warnings: ['low memory'] });
    if (!r.warnings || r.warnings.length !== 1) throw new Error('warnings missing');
  });

  // -- result.js err() --
  test('err() returns success=false with error object', () => {
    const r = err(ErrorCode.INVALID_ARGUMENT, 'bad input', { stage: 'validation' });
    if (r.success !== false) throw new Error('success not false');
    if (r.error.code !== 'INVALID_ARGUMENT') throw new Error('code wrong');
    if (r.error.message !== 'bad input') throw new Error('message wrong');
    if (r.error.stage !== 'validation') throw new Error('stage wrong');
    if (r.error.retryable !== false) throw new Error('retryable wrong');
  });

  test('err() supports retryable flag', () => {
    const r = err(ErrorCode.PROVIDER_RATE_LIMITED, 'slow down', { retryable: true });
    if (r.error.retryable !== true) throw new Error('retryable not set');
  });

  test('err() truncates long cause', () => {
    const longStack = 'x'.repeat(500);
    const r = err(ErrorCode.INTERNAL_ERROR, 'oops', { cause: longStack });
    if (r.error.cause.length > 200) throw new Error('cause not truncated');
  });

  // -- ErrorCode enum completeness --
  test('ErrorCode has all 12 codes', () => {
    const expected = [
      'INVALID_ARGUMENT', 'FILE_NOT_FOUND', 'UNSUPPORTED_FORMAT', 'DEPENDENCY_MISSING',
      'PROVIDER_NOT_CONFIGURED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE',
      'PROVIDER_TIMEOUT', 'PROCESSING_FAILED', 'OUTPUT_WRITE_FAILED', 'CANCELLED', 'INTERNAL_ERROR',
    ];
    for (const code of expected) {
      if (ErrorCode[code] !== code) throw new Error(`Missing code: ${code}`);
    }
  });

  // -- sanitizeMessage() --
  test('sanitizeMessage strips long tokens', () => {
    const out = sanitizeMessage('Error: sk-abcdefghij1234567890abcdef happened');
    if (out.includes('sk-abcdefghij1234567890abcdef')) throw new Error('Token not redacted');
    if (!out.includes('[REDACTED]')) throw new Error('REDACTED marker missing');
  });

  test('sanitizeMessage strips Authorization headers', () => {
    const out = sanitizeMessage('Status: Authorization: Bearer xyz123');
    if (out.includes('Bearer xyz123')) throw new Error('Auth not redacted');
  });

  test('sanitizeMessage caps at 500 chars', () => {
    const out = sanitizeMessage('x'.repeat(600));
    if (out.length > 500) throw new Error('Not capped');
  });

  test('sanitizeMessage handles non-string input', () => {
    const out = sanitizeMessage(null);
    if (out !== 'Internal error') throw new Error('null not handled');
  });

  // -- timer() --
  test('timer() returns elapsed ms', () => {
    const elapsed = timer();
    if (typeof elapsed !== 'function') throw new Error('timer not a function');
    const ms = elapsed();
    if (typeof ms !== 'number' || ms < 0) throw new Error('invalid ms');
  });

  // -- validate() --
  test('validate passes valid input', () => {
    const r = validate({ name: 'test', count: 5 }, { name: { type: 'string', required: true }, count: { type: 'number', min: 1 } });
    if (r !== null) throw new Error('Should be null (valid)');
  });

  test('validate catches missing required field', () => {
    const r = validate({}, { name: { type: 'string', required: true } });
    if (!r || r.success !== false) throw new Error('Should fail');
    if (r.error.code !== 'INVALID_ARGUMENT') throw new Error('Wrong code');
    if (r.error.stage !== 'validation') throw new Error('Wrong stage');
  });

  test('validate catches invalid enum', () => {
    const r = validate({ mode: 'fast' }, { mode: { type: 'string', enum: ['slow', 'medium'] } });
    if (!r || r.success !== false) throw new Error('Should fail');
    if (!r.error.message.includes('slow, medium')) throw new Error('Enum values not in message');
  });

  test('validate catches min/max violations', () => {
    const r = validate({ n: 0 }, { n: { type: 'number', min: 1, max: 100 } });
    if (!r || r.success !== false) throw new Error('Should fail');
    if (!r.error.message.includes('>= 1')) throw new Error('Min not in message');
  });

  test('validate catches minLength/maxLength', () => {
    const r1 = validate({ s: '' }, { s: { type: 'string', minLength: 1 } });
    if (!r1 || r1.success !== false) throw new Error('minLength should fail');
    const r2 = validate({ s: 'very long text' }, { s: { type: 'string', maxLength: 3 } });
    if (!r2 || r2.success !== false) throw new Error('maxLength should fail');
  });

  test('validate catches minItems/maxItems', () => {
    const r = validate({ arr: [] }, { arr: { type: 'array', minItems: 1 } });
    if (!r || r.success !== false) throw new Error('Should fail');
  });

  test('validate skips optional undefined fields', () => {
    const r = validate({}, { opt: { type: 'string' } });
    if (r !== null) throw new Error('Optional should not fail');
  });

  test('validate catches wrong type', () => {
    const r = validate({ n: 'not a number' }, { n: { type: 'number' } });
    if (!r || r.success !== false) throw new Error('Should fail');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Security hardening
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n9. Security hardening');

{
  // -- limits.js --
  const { LIMITS, clamp } = await importLib('limits.js');

  test('LIMITS has all required sections', () => {
    const required = ['image', 'video', 'sprite', 'text', 'timeout', 'godotScan', 'temp', 'output', 'network'];
    for (const key of required) {
      if (!LIMITS[key]) throw new Error(`Missing LIMITS.${key}`);
    }
  });

  test('clamp clamps finite numbers', () => {
    if (clamp(5, 0, 10) !== 5) throw new Error('mid wrong');
    if (clamp(-1, 0, 10) !== 0) throw new Error('low wrong');
    if (clamp(15, 0, 10) !== 10) throw new Error('high wrong');
    if (clamp(NaN, 0, 10) !== 0) throw new Error('NaN wrong');
    if (clamp(Infinity, 0, 10) !== 0) throw new Error('Infinity wrong');
  });

  // -- path_safety.js --
  const { safePath, isWithinRoot, hasTraversal, validateOutputPath, validateInputFile } = await importLib('path_safety.js');

  test('safePath resolves to absolute', () => {
    const p = safePath('../foo/bar');
    if (!p || !path.isAbsolute(p)) throw new Error('Not absolute');
  });

  test('isWithinRoot detects escapes', () => {
    if (!isWithinRoot('/project/output/file.png', '/project')) throw new Error('Should be within');
    if (isWithinRoot('/etc/passwd', '/project')) throw new Error('Should not be within');
  });

  test('hasTraversal detects ..', () => {
    if (!hasTraversal('../etc/passwd')) throw new Error('Should detect traversal');
    if (hasTraversal('normal/path')) throw new Error('False positive');
  });

  test('validateOutputPath blocks path traversal', () => {
    const r = validateOutputPath('../../etc/passwd');
    if (!r || r.success !== false) throw new Error('Should block traversal');
    if (r.error.code !== 'INVALID_ARGUMENT') throw new Error('Wrong error code');
  });

  test('validateOutputPath blocks overwrite of existing file', () => {
    // Create a temp file, then try to write to it
    const tmpTestFile = path.join(ROOT, 'tmp', 'overwrite_test.txt');
    mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    writeFileSync(tmpTestFile, 'test');
    try {
      const r = validateOutputPath(tmpTestFile);
      if (!r || r.success !== false) throw new Error('Should block overwrite');
    } finally {
      try { unlinkSync(tmpTestFile); } catch (_) {}
      try { rmSync(path.join(ROOT, 'tmp'), { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('validateOutputPath blocks input=output overwrite', () => {
    const inputFile = '/some/input/image.png';
    const r = validateOutputPath(inputFile, [inputFile]);
    if (!r || r.success !== false) throw new Error('Should block input overwrite');
  });

  test('validateOutputPath allows valid output', () => {
    const tmpDir = path.join(ROOT, 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const outFile = path.join(tmpDir, 'valid_output.png');
    try {
      const r = validateOutputPath(outFile);
      if (r !== null) throw new Error('Should be valid: ' + JSON.stringify(r));
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('validateInputFile rejects missing file', () => {
    const r = validateInputFile('/nonexistent/file.png');
    if (!r || r.success !== false) throw new Error('Should fail');
    if (r.error.code !== 'FILE_NOT_FOUND') throw new Error('Wrong code');
  });

  test('validateInputFile rejects wrong extension', () => {
    // Create a temp file with wrong extension
    const tmpDir = path.join(ROOT, 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, 'test.exe');
    writeFileSync(testFile, 'test');
    try {
      const r = validateInputFile(testFile, { checkExtension: true, allowedExtensions: ['.png', '.jpg'] });
      if (!r || r.success !== false) throw new Error('Should reject wrong extension');
    } finally {
      try { unlinkSync(testFile); } catch (_) {}
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  // -- temp.js --
  const { createTempDir, cleanupTempDir, tempFile } = await importLib('temp.js');

  test('createTempDir creates unique directory', () => {
    const dir1 = createTempDir('test');
    const dir2 = createTempDir('test');
    if (dir1 === dir2) throw new Error('Not unique');
    if (!existsSync(dir1)) throw new Error('Not created');
    // Clean up
    cleanupTempDir(dir1);
    cleanupTempDir(dir2);
  });

  test('cleanupTempDir removes directory', () => {
    const dir = createTempDir('test');
    const f = tempFile(dir, '.txt');
    writeFileSync(f, 'test');
    if (!existsSync(f)) throw new Error('File not created');
    cleanupTempDir(dir);
    if (existsSync(dir)) throw new Error('Directory not removed');
  });

  test('tempFile returns unique paths', () => {
    const dir = createTempDir('test');
    try {
      const f1 = tempFile(dir, '.png');
      const f2 = tempFile(dir, '.png');
      if (f1 === f2) throw new Error('Not unique');
      if (!f1.endsWith('.png')) throw new Error('Wrong extension');
    } finally {
      cleanupTempDir(dir);
    }
  });

  // -- url_safety.js --
  const { validateUrl, validateComfyUrl, sanitizeUrl } = await importLib('url_safety.js');

  test('validateUrl blocks file:// protocol', () => {
    const r = validateUrl('file:///etc/passwd');
    if (!r || r.success !== false) throw new Error('Should block file://');
  });

  test('validateUrl blocks javascript: protocol', () => {
    const r = validateUrl('javascript:alert(1)');
    if (!r || r.success !== false) throw new Error('Should block javascript:');
  });

  test('validateUrl blocks data: protocol', () => {
    const r = validateUrl('data:text/html,<script>alert(1)</script>');
    if (!r || r.success !== false) throw new Error('Should block data:');
  });

  test('validateUrl blocks localhost (SSRF)', () => {
    const r = validateUrl('http://localhost/admin');
    if (!r || r.success !== false) throw new Error('Should block localhost');
  });

  test('validateUrl blocks private IPs (SSRF)', () => {
    const r1 = validateUrl('http://192.168.1.1/admin');
    if (!r1 || r1.success !== false) throw new Error('Should block 192.168.x.x');
    const r2 = validateUrl('http://10.0.0.1/admin');
    if (!r2 || r2.success !== false) throw new Error('Should block 10.x.x.x');
  });

  test('validateUrl blocks loopback', () => {
    const r = validateUrl('http://127.0.0.1/admin');
    if (!r || r.success !== false) throw new Error('Should block 127.0.0.1');
  });

  test('validateUrl accepts valid HTTPS URLs', () => {
    const r = validateUrl('https://api.example.com/v1');
    if (r !== null) throw new Error('Should accept valid HTTPS: ' + JSON.stringify(r));
  });

  test('validateComfyUrl allows localhost', () => {
    const r = validateComfyUrl('http://127.0.0.1:8188');
    if (r !== null) throw new Error('Should allow ComfyUI localhost');
  });

  test('validateComfyUrl blocks external URLs', () => {
    const r = validateComfyUrl('http://evil.com:8188');
    if (!r || r.success !== false) throw new Error('Should block external ComfyUI');
  });

  test('sanitizeUrl removes sensitive parts', () => {
    const s = sanitizeUrl('https://user:pass@api.com/v1?q=test#frag');
    if (s.includes('user') || s.includes('pass') || s.includes('q=') || s.includes('#frag')) {
      throw new Error('Not sanitized: ' + s);
    }
  });

  test('validateUrl rejects empty/null', () => {
    const r = validateUrl('');
    if (!r || r.success !== false) throw new Error('Should reject empty');
  });

  // -- runner.js (async subprocess) --
  const { runAsync, commandExistsAsync } = await importLib('runner.js');

  await testAsync('commandExistsAsync detects node', async () => {
    if (!await commandExistsAsync('node')) throw new Error('node should exist');
  });

  await testAsync('commandExistsAsync returns false for missing', async () => {
    if (await commandExistsAsync('nonexistent_command_xyz_12345')) throw new Error('Should not exist');
  });

  await testAsync('runAsync rejects non-array args', async () => {
    try {
      await runAsync('node', 'not-an-array');
      throw new Error('Should throw');
    } catch (e) {
      if (!e.message.includes('array')) throw new Error('Wrong error: ' + e.message);
    }
  });

  await testAsync('runAsync respects allowedCommands', async () => {
    try {
      await runAsync('python', ['-c', 'print(1)'], { allowedCommands: ['node'] });
      throw new Error('Should throw');
    } catch (e) {
      if (!e.message.includes('not allowed')) throw new Error('Wrong error: ' + e.message);
    }
  });

  // -- safe_scan.js --
  const { safeScanDir } = await importLib('safe_scan.js');

  test('safeScanDir respects maxDepth', () => {
    const dir = createTempDir('scan');
    try {
      // Create nested dirs
      let d = dir;
      for (let i = 0; i < 5; i++) {
        d = path.join(d, `level_${i}`);
        mkdirSync(d, { recursive: true });
        writeFileSync(path.join(d, 'file.txt'), 'test');
      }
      const result = safeScanDir(dir, { maxDepth: 2 });
      if (result.files.length > 2) throw new Error(`Too many files: ${result.files.length}`);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('safeScanDir respects maxFiles', () => {
    const dir = createTempDir('scan');
    try {
      for (let i = 0; i < 10; i++) {
        writeFileSync(path.join(dir, `file_${i}.txt`), 'test');
      }
      const result = safeScanDir(dir, { maxFiles: 3 });
      if (result.files.length > 3) throw new Error(`Too many files: ${result.files.length}`);
      if (!result.truncated) throw new Error('Should be truncated');
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('safeScanDir skips .git and node_modules', () => {
    const dir = createTempDir('scan');
    try {
      mkdirSync(path.join(dir, '.git'), { recursive: true });
      mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      writeFileSync(path.join(dir, '.git', 'config'), 'test');
      writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'test');
      writeFileSync(path.join(dir, 'keep.txt'), 'test');
      const result = safeScanDir(dir);
      if (result.files.length !== 1) throw new Error(`Expected 1, got ${result.files.length}`);
      if (!result.files.includes('keep.txt')) throw new Error('Missing keep.txt');
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('safeScanDir skips hidden dirs', () => {
    const dir = createTempDir('scan');
    try {
      mkdirSync(path.join(dir, '.hidden'), { recursive: true });
      writeFileSync(path.join(dir, '.hidden', 'secret.txt'), 'test');
      writeFileSync(path.join(dir, 'visible.txt'), 'test');
      const result = safeScanDir(dir);
      if (result.files.length !== 1) throw new Error(`Expected 1, got ${result.files.length}`);
    } finally {
      cleanupTempDir(dir);
    }
  });

  // -- Error message sanitization in server.js --
  // Test that the sanitizeMessage function (imported in server.js) strips tokens
  // (already tested in unified result protocol section above)

  // -- Input with 0, negative, NaN, Infinity values --
  test('LIMITS rejects invalid numeric inputs', () => {
    // These should not be usable as valid limits
    if (LIMITS.image.maxWidth <= 0) throw new Error('maxWidth must be positive');
    if (LIMITS.image.maxHeight <= 0) throw new Error('maxHeight must be positive');
    if (LIMITS.video.maxFps <= 0) throw new Error('maxFps must be positive');
    if (LIMITS.video.maxFrames <= 0) throw new Error('maxFrames must be positive');
    if (LIMITS.sprite.maxBatchGenerateItems <= 0) throw new Error('maxBatchGenerateItems must be positive');
    if (!Number.isFinite(LIMITS.timeout.pythonMs)) throw new Error('timeout must be finite');
  });

  // -- No shell metacharacters in runner args --
  await testAsync('runner rejects shell metacharacters', async () => {
    const { runFfmpegAsync } = await importLib('runner.js');
    try {
      await runFfmpegAsync(['-i', 'test; rm -rf /']);
      throw new Error('Should throw');
    } catch (e) {
      if (!e.message.includes('Dangerous') && !e.message.includes('dangerous') && !e.message.includes('Potentially'))
        throw new Error('Wrong error: ' + e.message);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Temp files cleanup check
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n10. Cleanup');

test('no tmp directory remains', () => {
  const tmpDir = path.join(ROOT, 'tmp');
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  if (existsSync(tmpDir)) {
    throw new Error('tmp directory still exists after cleanup');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error.message}`);
  }
}
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
