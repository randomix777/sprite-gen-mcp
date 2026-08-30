/**
 * Provider penetration tests — exercises generateImage() through a local
 * mock server for ALL 4 providers (Gemini, Stable Diffusion, Agnes, ComfyUI).
 *
 * Does NOT access any real API. Config is saved/restored via try/finally.
 * Each provider uses its own mock route — not all sharing one handler.
 */

import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

// ─── Test framework ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ─── Mock data ───────────────────────────────────────────────────────────

/** 1×1 transparent PNG (base64) */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const TINY_PNG_BUF = Buffer.from(TINY_PNG, 'base64');
const PROMPT_ID = 'test-prompt-id-12345';

// ─── Route matching ──────────────────────────────────────────────────────

function matchRoute(pathname, method) {
  if (pathname.startsWith('/v1beta/models/') && pathname.endsWith(':generateContent')) return 'gemini';
  if (pathname === '/sdapi/v1/txt2img') return 'sd';
  if (pathname === '/v1/images/generations') return 'agnes';
  if (pathname === '/prompt' && method === 'POST') return 'comfy_queue';
  if (pathname.startsWith('/history/')) return 'comfy_history';
  if (pathname === '/view') return 'comfy_view';
  return null;
}

// ─── Mock server ─────────────────────────────────────────────────────────

function createMockServer() {
  const requestLog = [];
  const behaviors = {};

  function setBehavior(route, config) {
    behaviors[route] = { status: 200, body: 'success', delay: 0, ...config };
  }

  function clearRequestLog() {
    requestLog.length = 0;
  }

  function clearBehaviors() {
    for (const key of Object.keys(behaviors)) delete behaviors[key];
  }

  const server = createServer(async (req, res) => {
    // Read request body (only for methods that carry one)
    let rawBody = '';
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      rawBody = Buffer.concat(chunks).toString();
    }
    let parsedBody;
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }

    const url = new URL(req.url, `http://127.0.0.1`);

    // Log request
    requestLog.push({
      method: req.method,
      url: req.url,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { ...req.headers },
      body: parsedBody,
    });

    // Match route
    const route = matchRoute(url.pathname, req.method);
    const behavior = behaviors[route] || { status: 404, body: 'Not found', delay: 0 };

    // Apply delay
    if (behavior.delay > 0) {
      await new Promise(r => setTimeout(r, behavior.delay));
    }

    // Error responses (4xx, 5xx)
    if (behavior.status >= 400) {
      const errBody = {
        error: {
          message: 'Mock error',
          status: behavior.status === 401 ? 'UNAUTHENTICATED'
            : behavior.status === 429 ? 'RESOURCE_EXHAUSTED'
            : 'INTERNAL',
        },
      };
      res.writeHead(behavior.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errBody));
      return;
    }

    // Success responses per route
    const { body } = behavior;
    switch (route) {
      case 'gemini': {
        if (body === 'empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ candidates: [] }));
        } else if (body === 'invalid_json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('NOT JSON {{{');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: TINY_PNG } }],
              },
            }],
          }));
        }
        break;
      }

      case 'sd': {
        if (body === 'empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ images: [] }));
        } else if (body === 'invalid_json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('NOT JSON {{{');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ images: [TINY_PNG] }));
        }
        break;
      }

      case 'agnes': {
        if (body === 'empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        } else if (body === 'invalid_json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('NOT JSON {{{');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG }] }));
        }
        break;
      }

      case 'comfy_queue': {
        if (body === 'invalid_json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('NOT JSON {{{');
        } else if (body === 'empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ prompt_id: PROMPT_ID }));
        }
        break;
      }

      case 'comfy_history': {
        if (body === 'no_images') {
          // Valid response but no images in outputs
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            [PROMPT_ID]: { outputs: {} },
          }));
        } else if (body === 'empty') {
          // Empty response — polling won't find prompt_id, will keep polling
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          // Default success: outputs with images
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            [PROMPT_ID]: {
              outputs: {
                '9': {
                  images: [{
                    filename: 'sprite_gen_00001_.png',
                    subfolder: '',
                    type: 'output',
                  }],
                },
              },
            },
          }));
        }
        break;
      }

      case 'comfy_view': {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(TINY_PNG_BUF);
        break;
      }

      default: {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  return {
    server,
    requestLog,
    setBehavior,
    clearRequestLog,
    clearBehaviors,
    start() {
      return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
    },
    stop() {
      return new Promise(resolve => { server.close(resolve); });
    },
    getPort() {
      return server.address().port;
    },
  };
}

// ─── Config isolation ────────────────────────────────────────────────────

let savedConfig = null;

function setupIsolatedConfig(port) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (existsSync(CONFIG_FILE)) {
    savedConfig = readFileSync(CONFIG_FILE, 'utf8');
  }
  const testConfig = {
    defaultProvider: 'gemini_flash',
    credentials: {
      gemini_flash: { apiKey: 'test-key-not-real', baseUrl: `http://127.0.0.1:${port}` },
      stable_diffusion: { apiKey: 'test-key-not-real', baseUrl: `http://127.0.0.1:${port}` },
      agnes: { apiKey: 'test-key-not-real', baseUrl: `http://127.0.0.1:${port}` },
      comfy: { baseUrl: `http://127.0.0.1:${port}` },
    },
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(testConfig, null, 2));
}

function restoreConfig() {
  if (savedConfig !== null) {
    writeFileSync(CONFIG_FILE, savedConfig);
    savedConfig = null;
  } else if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }
}

// ─── Shared error-mapping helper ─────────────────────────────────────────

async function assertErrorMapping(generateImage, mock, provider, route, status, expectedCode, expectedRetryable, label) {
  mock.setBehavior(route, { status });
  const result = await generateImage({ provider, prompt: `${label} test`, width: 64, height: 64 });
  assert(result.success === false, `${label}: expected success=false, got ${result.success}`);
  assert(
    result.error.code === expectedCode,
    `${label}: expected error.code=${expectedCode}, got ${result.error.code}`,
  );
  assert(
    result.error.retryable === expectedRetryable,
    `${label}: expected retryable=${expectedRetryable}, got ${result.error.retryable}`,
  );
}

// ─── GEMINI TESTS ────────────────────────────────────────────────────────

async function testGemini(generateImage, mock) {
  const provider = 'gemini_flash';
  const route = 'gemini';

  // 1. Success
  await testAsync('success: returns images with correct metadata', async () => {
    mock.clearRequestLog();
    mock.setBehavior(route, { status: 200, body: 'success' });
    const result = await generateImage({ provider, prompt: 'test sprite', width: 64, height: 64 });
    assert(result.success === true, `expected success=true, got ${result.success}`);
    assert(result.data.images.length > 0, `expected images, got ${result.data.images.length}`);
    assert(typeof result.data.images[0].data === 'string', 'image data should be a string');
    assert(result.data.images[0].mimeType === 'image/png', `expected mimeType image/png, got ${result.data.images[0].mimeType}`);
    assert(result.data.provider === provider, `expected provider=${provider}, got ${result.data.provider}`);
  });

  // 2. Request validation
  test('request: POST /v1beta/models/…/generateContent, key in query, JSON content-type', () => {
    const log = mock.requestLog.filter(r => r.path.includes('generateContent'));
    assert(log.length > 0, 'expected at least one Gemini request in log');
    const last = log[log.length - 1];
    assert(last.method === 'POST', `expected POST, got ${last.method}`);
    assert(last.path.startsWith('/v1beta/models/'), `expected /v1beta/models/…, got ${last.path}`);
    assert(last.path.includes(':generateContent'), 'expected :generateContent in path');
    const reqUrl = new URL(last.url, 'http://127.0.0.1');
    assert(reqUrl.searchParams.has('key'), 'expected key query parameter');
    assert(reqUrl.searchParams.get('key') === 'test-key-not-real', 'expected correct API key in query');
    assert(last.headers['content-type']?.includes('application/json'), 'expected Content-Type application/json');
  });

  // 3. 401
  await testAsync('401 → PROVIDER_AUTH_FAILED, retryable=false', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 401, 'PROVIDER_AUTH_FAILED', false, '401');
  });

  // 4. 429
  await testAsync('429 → PROVIDER_RATE_LIMITED, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 429, 'PROVIDER_RATE_LIMITED', true, '429');
  });

  // 5. 500
  await testAsync('500 → PROVIDER_UNAVAILABLE, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 500, 'PROVIDER_UNAVAILABLE', true, '500');
  });

  // 6. Empty images (valid JSON but no candidates)
  await testAsync('empty: valid response with no candidates → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'empty' });
    const result = await generateImage({ provider, prompt: 'empty test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false for empty candidates, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 7. Invalid JSON
  await testAsync('invalid JSON → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'invalid_json' });
    const result = await generateImage({ provider, prompt: 'json error', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 8. Caller cancel (AbortSignal)
  await testAsync('caller cancel → CANCELLED, retryable=false', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 15000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const result = await generateImage({ provider, prompt: 'cancel test', width: 64, height: 64, signal: controller.signal });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'CANCELLED', `expected CANCELLED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 9. Internal timeout (mutate LIMITS to trigger quickly)
  await testAsync('internal timeout → PROVIDER_TIMEOUT, retryable=true', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 5000 });
    const { LIMITS } = await import('../lib/limits.js');
    const saved = LIMITS.timeout.fetchMs;
    try {
      LIMITS.timeout.fetchMs = 500;
      const result = await generateImage({ provider, prompt: 'timeout test', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_TIMEOUT', `expected PROVIDER_TIMEOUT, got ${result.error.code}`);
      assert(result.error.retryable === true, `expected retryable=true, got ${result.error.retryable}`);
    } finally {
      LIMITS.timeout.fetchMs = saved;
    }
  });

  // 10. No API key
  await testAsync('no API key → PROVIDER_NOT_CONFIGURED', async () => {
    const saved = readFileSync(CONFIG_FILE, 'utf8');
    try {
      const cfg = JSON.parse(saved);
      cfg.credentials[provider].apiKey = '';
      writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      const result = await generateImage({ provider, prompt: 'no key', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_NOT_CONFIGURED', `expected PROVIDER_NOT_CONFIGURED, got ${result.error.code}`);
    } finally {
      writeFileSync(CONFIG_FILE, saved);
    }
  });

  // 11. API key not leaked
  await testAsync('API key not leaked in any result/error', async () => {
    mock.setBehavior(route, { status: 401 });
    const result = await generateImage({ provider, prompt: 'leak test', width: 64, height: 64 });
    const json = JSON.stringify(result);
    assert(!json.includes('test-key-not-real'), 'result must not contain API key');
  });
}

// ─── STABLE DIFFUSION TESTS ──────────────────────────────────────────────

async function testStableDiffusion(generateImage, mock) {
  const provider = 'stable_diffusion';
  const route = 'sd';

  // 1. Success
  await testAsync('success: returns images with correct metadata', async () => {
    mock.clearRequestLog();
    mock.setBehavior(route, { status: 200, body: 'success' });
    const result = await generateImage({ provider, prompt: 'test sprite', width: 64, height: 64 });
    assert(result.success === true, `expected success=true, got ${result.success}`);
    assert(result.data.images.length > 0, `expected images, got ${result.data.images.length}`);
    assert(typeof result.data.images[0].data === 'string', 'image data should be a string');
    assert(result.data.images[0].mimeType === 'image/png', `expected mimeType image/png, got ${result.data.images[0].mimeType}`);
    assert(result.data.provider === provider, `expected provider=${provider}`);
  });

  // 2. Request validation
  test('request: POST /sdapi/v1/txt2img, JSON content-type', () => {
    const log = mock.requestLog.filter(r => r.path === '/sdapi/v1/txt2img');
    assert(log.length > 0, 'expected at least one SD request in log');
    const last = log[log.length - 1];
    assert(last.method === 'POST', `expected POST, got ${last.method}`);
    assert(last.headers['content-type']?.includes('application/json'), 'expected Content-Type application/json');
    // SD sends prompt in both query params and body
    assert(typeof last.body === 'object' && last.body.prompt, 'expected body with prompt field');
  });

  // 3. 401
  await testAsync('401 → PROVIDER_AUTH_FAILED, retryable=false', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 401, 'PROVIDER_AUTH_FAILED', false, '401');
  });

  // 4. 429
  await testAsync('429 → PROVIDER_RATE_LIMITED, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 429, 'PROVIDER_RATE_LIMITED', true, '429');
  });

  // 5. 500
  await testAsync('500 → PROVIDER_UNAVAILABLE, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 500, 'PROVIDER_UNAVAILABLE', true, '500');
  });

  // 6. Empty images
  await testAsync('empty: valid response with no images → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'empty' });
    const result = await generateImage({ provider, prompt: 'empty test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false for empty images, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 7. Invalid JSON
  await testAsync('invalid JSON → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'invalid_json' });
    const result = await generateImage({ provider, prompt: 'json error', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 8. Caller cancel
  await testAsync('caller cancel → CANCELLED, retryable=false', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 15000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const result = await generateImage({ provider, prompt: 'cancel test', width: 64, height: 64, signal: controller.signal });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'CANCELLED', `expected CANCELLED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 9. Internal timeout
  await testAsync('internal timeout → PROVIDER_TIMEOUT, retryable=true', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 5000 });
    const { LIMITS } = await import('../lib/limits.js');
    const saved = LIMITS.timeout.fetchMs;
    try {
      LIMITS.timeout.fetchMs = 500;
      const result = await generateImage({ provider, prompt: 'timeout test', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_TIMEOUT', `expected PROVIDER_TIMEOUT, got ${result.error.code}`);
      assert(result.error.retryable === true, `expected retryable=true, got ${result.error.retryable}`);
    } finally {
      LIMITS.timeout.fetchMs = saved;
    }
  });

  // 10. No API key
  await testAsync('no API key → PROVIDER_NOT_CONFIGURED', async () => {
    const saved = readFileSync(CONFIG_FILE, 'utf8');
    try {
      const cfg = JSON.parse(saved);
      cfg.credentials[provider].apiKey = '';
      writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      const result = await generateImage({ provider, prompt: 'no key', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_NOT_CONFIGURED', `expected PROVIDER_NOT_CONFIGURED, got ${result.error.code}`);
    } finally {
      writeFileSync(CONFIG_FILE, saved);
    }
  });

  // 11. API key not leaked
  await testAsync('API key not leaked in any result/error', async () => {
    mock.setBehavior(route, { status: 401 });
    const result = await generateImage({ provider, prompt: 'leak test', width: 64, height: 64 });
    const json = JSON.stringify(result);
    assert(!json.includes('test-key-not-real'), 'result must not contain API key');
  });
}

// ─── AGNES TESTS ─────────────────────────────────────────────────────────

async function testAgnes(generateImage, mock) {
  const provider = 'agnes';
  const route = 'agnes';

  // 1. Success
  await testAsync('success: returns images with correct metadata', async () => {
    mock.clearRequestLog();
    mock.setBehavior(route, { status: 200, body: 'success' });
    const result = await generateImage({ provider, prompt: 'test sprite', width: 64, height: 64 });
    assert(result.success === true, `expected success=true, got ${result.success}`);
    assert(result.data.images.length > 0, `expected images, got ${result.data.images.length}`);
    assert(typeof result.data.images[0].data === 'string', 'image data should be a string');
    assert(result.data.images[0].mimeType === 'image/png', `expected mimeType image/png, got ${result.data.images[0].mimeType}`);
    assert(result.data.provider === provider, `expected provider=${provider}`);
  });

  // 2. Request validation
  test('request: POST /v1/images/generations, Bearer auth, JSON content-type', () => {
    const log = mock.requestLog.filter(r => r.path === '/v1/images/generations');
    assert(log.length > 0, 'expected at least one Agnes request in log');
    const last = log[log.length - 1];
    assert(last.method === 'POST', `expected POST, got ${last.method}`);
    assert(last.headers['content-type']?.includes('application/json'), 'expected Content-Type application/json');
    assert(
      last.headers['authorization'] === 'Bearer test-key-not-real',
      `expected Bearer auth header, got ${last.headers['authorization']}`,
    );
    assert(typeof last.body === 'object' && last.body.prompt, 'expected body with prompt field');
  });

  // 3. 401
  await testAsync('401 → PROVIDER_AUTH_FAILED, retryable=false', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 401, 'PROVIDER_AUTH_FAILED', false, '401');
  });

  // 4. 429
  await testAsync('429 → PROVIDER_RATE_LIMITED, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 429, 'PROVIDER_RATE_LIMITED', true, '429');
  });

  // 5. 500
  await testAsync('500 → PROVIDER_UNAVAILABLE, retryable=true', async () => {
    await assertErrorMapping(generateImage, mock, provider, route, 500, 'PROVIDER_UNAVAILABLE', true, '500');
  });

  // 6. Empty images
  await testAsync('empty: valid response with no data → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'empty' });
    const result = await generateImage({ provider, prompt: 'empty test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false for empty data, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 7. Invalid JSON
  await testAsync('invalid JSON → PROCESSING_FAILED', async () => {
    mock.setBehavior(route, { status: 200, body: 'invalid_json' });
    const result = await generateImage({ provider, prompt: 'json error', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 8. Caller cancel
  await testAsync('caller cancel → CANCELLED, retryable=false', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 15000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const result = await generateImage({ provider, prompt: 'cancel test', width: 64, height: 64, signal: controller.signal });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'CANCELLED', `expected CANCELLED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 9. Internal timeout
  await testAsync('internal timeout → PROVIDER_TIMEOUT, retryable=true', async () => {
    mock.setBehavior(route, { status: 200, body: 'success', delay: 5000 });
    const { LIMITS } = await import('../lib/limits.js');
    const saved = LIMITS.timeout.fetchMs;
    try {
      LIMITS.timeout.fetchMs = 500;
      const result = await generateImage({ provider, prompt: 'timeout test', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_TIMEOUT', `expected PROVIDER_TIMEOUT, got ${result.error.code}`);
      assert(result.error.retryable === true, `expected retryable=true, got ${result.error.retryable}`);
    } finally {
      LIMITS.timeout.fetchMs = saved;
    }
  });

  // 10. No API key
  await testAsync('no API key → PROVIDER_NOT_CONFIGURED', async () => {
    const saved = readFileSync(CONFIG_FILE, 'utf8');
    try {
      const cfg = JSON.parse(saved);
      cfg.credentials[provider].apiKey = '';
      writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      const result = await generateImage({ provider, prompt: 'no key', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'PROVIDER_NOT_CONFIGURED', `expected PROVIDER_NOT_CONFIGURED, got ${result.error.code}`);
    } finally {
      writeFileSync(CONFIG_FILE, saved);
    }
  });

  // 11. API key not leaked
  await testAsync('API key not leaked in any result/error', async () => {
    mock.setBehavior(route, { status: 401 });
    const result = await generateImage({ provider, prompt: 'leak test', width: 64, height: 64 });
    const json = JSON.stringify(result);
    assert(!json.includes('test-key-not-real'), 'result must not contain API key');
  });
}

// ─── COMFYUI TESTS ───────────────────────────────────────────────────────

async function testComfy(generateImage, mock) {
  const provider = 'comfy';

  // Set all ComfyUI routes to default success for tests that need the full pipeline
  function comfySuccess() {
    mock.setBehavior('comfy_queue', { status: 200, body: 'success' });
    mock.setBehavior('comfy_history', { status: 200, body: 'success' });
    mock.setBehavior('comfy_view', { status: 200, body: 'success' });
  }

  // 1. Success (queue → poll history → download view)
  await testAsync('success: queue → history → view returns images', async () => {
    mock.clearRequestLog();
    comfySuccess();
    const result = await generateImage({ provider, prompt: 'test sprite', width: 64, height: 64 });
    assert(result.success === true, `expected success=true, got ${result.success}`);
    assert(result.data.images.length > 0, `expected images, got ${result.data.images.length}`);
    assert(typeof result.data.images[0].data === 'string', 'image data should be a string');
    assert(result.data.images[0].mimeType === 'image/png', `expected mimeType image/png`);
    assert(result.data.provider === provider, `expected provider=${provider}`);
  });

  // 2. Request validation (queue, history, view)
  test('request: POST /prompt, GET /history/{id}, GET /view', () => {
    const queueReqs = mock.requestLog.filter(r => r.path === '/prompt');
    const historyReqs = mock.requestLog.filter(r => r.path.startsWith('/history/'));
    const viewReqs = mock.requestLog.filter(r => r.path === '/view');
    assert(queueReqs.length > 0, 'expected at least one /prompt request');
    assert(historyReqs.length > 0, 'expected at least one /history request');
    assert(viewReqs.length > 0, 'expected at least one /view request');
    const q = queueReqs[queueReqs.length - 1];
    assert(q.method === 'POST', `expected POST for /prompt, got ${q.method}`);
    assert(q.headers['content-type']?.includes('application/json'), 'expected Content-Type for queue');
    const h = historyReqs[historyReqs.length - 1];
    assert(h.method === 'GET', `expected GET for /history, got ${h.method}`);
    assert(h.path.startsWith('/history/'), `expected /history/… path, got ${h.path}`);
    const v = viewReqs[viewReqs.length - 1];
    assert(v.method === 'GET', `expected GET for /view, got ${v.method}`);
  });

  // 3. Queue 401
  await testAsync('queue 401 → PROVIDER_AUTH_FAILED, retryable=false', async () => {
    mock.setBehavior('comfy_queue', { status: 401 });
    const result = await generateImage({ provider, prompt: 'auth test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROVIDER_AUTH_FAILED', `expected PROVIDER_AUTH_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 4. Queue 429
  await testAsync('queue 429 → PROVIDER_RATE_LIMITED, retryable=true', async () => {
    mock.setBehavior('comfy_queue', { status: 429 });
    const result = await generateImage({ provider, prompt: 'rate limit test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROVIDER_RATE_LIMITED', `expected PROVIDER_RATE_LIMITED, got ${result.error.code}`);
    assert(result.error.retryable === true, `expected retryable=true, got ${result.error.retryable}`);
  });

  // 5. Queue 500
  await testAsync('queue 500 → PROVIDER_UNAVAILABLE, retryable=true', async () => {
    mock.setBehavior('comfy_queue', { status: 500 });
    const result = await generateImage({ provider, prompt: 'server error test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROVIDER_UNAVAILABLE', `expected PROVIDER_UNAVAILABLE, got ${result.error.code}`);
    assert(result.error.retryable === true, `expected retryable=true, got ${result.error.retryable}`);
  });

  // 6. Empty images (history returns prompt_id but no images in outputs)
  await testAsync('empty: no images in outputs → PROCESSING_FAILED', async () => {
    mock.setBehavior('comfy_queue', { status: 200, body: 'success' });
    mock.setBehavior('comfy_history', { status: 200, body: 'no_images' });
    mock.setBehavior('comfy_view', { status: 200, body: 'success' });
    const result = await generateImage({ provider, prompt: 'empty test', width: 64, height: 64 });
    assert(result.success === false, `expected success=false for empty outputs, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
  });

  // 7. Invalid JSON on queue
  await testAsync('queue invalid JSON → PROCESSING_FAILED', async () => {
    mock.setBehavior('comfy_queue', { status: 200, body: 'invalid_json' });
    const result = await generateImage({ provider, prompt: 'json error', width: 64, height: 64 });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'PROCESSING_FAILED', `expected PROCESSING_FAILED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 8. Cancel during polling (cancel fires during cancellableDelay, before history request)
  await testAsync('cancel during polling → CANCELLED, retryable=false', async () => {
    mock.setBehavior('comfy_queue', { status: 200, body: 'success' });
    mock.setBehavior('comfy_history', { status: 200, body: 'success', delay: 15000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const result = await generateImage({ provider, prompt: 'cancel test', width: 64, height: 64, signal: controller.signal });
    assert(result.success === false, `expected success=false, got ${result.success}`);
    assert(result.error.code === 'CANCELLED', `expected CANCELLED, got ${result.error.code}`);
    assert(result.error.retryable === false, `expected retryable=false, got ${result.error.retryable}`);
  });

  // 9. No base URL (ComfyUI doesn't require API key, but requires base URL)
  await testAsync('no base URL → INTERNAL_ERROR', async () => {
    const saved = readFileSync(CONFIG_FILE, 'utf8');
    try {
      const cfg = JSON.parse(saved);
      cfg.credentials.comfy = { baseUrl: '' };
      writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      const result = await generateImage({ provider, prompt: 'no url', width: 64, height: 64 });
      assert(result.success === false, `expected success=false, got ${result.success}`);
      assert(result.error.code === 'INTERNAL_ERROR', `expected INTERNAL_ERROR, got ${result.error.code}`);
    } finally {
      writeFileSync(CONFIG_FILE, saved);
    }
  });

  // 10. API key not leaked
  await testAsync('API key not leaked in any result/error', async () => {
    mock.setBehavior('comfy_queue', { status: 401 });
    const result = await generateImage({ provider, prompt: 'leak test', width: 64, height: 64 });
    const json = JSON.stringify(result);
    assert(!json.includes('test-key-not-real'), 'result must not contain API key');
  });
}

// ─── Main test runner ────────────────────────────────────────────────────

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Provider Penetration Tests — All 4 Providers         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Global timeout guard (60s should be more than enough)
  const guard = setTimeout(() => {
    console.error('\nFATAL: Test suite timed out after 60s');
    process.exit(1);
  }, 60_000);

  const mock = createMockServer();
  await mock.start();
  const port = mock.getPort();
  console.log(`Mock server: http://127.0.0.1:${port}`);

  setupIsolatedConfig(port);
  console.log('Test config written (original saved)\n');

  try {
    // Dynamic import — ESM modules are cached after first load
    const { generateImage } = await import('../lib/image_gen.js');

    // ── Gemini ──
    console.log('━━━ Gemini Flash ━━━');
    await testGemini(generateImage, mock);

    // ── Stable Diffusion ──
    console.log('\n━━━ Stable Diffusion ━━━');
    await testStableDiffusion(generateImage, mock);

    // ── Agnes ──
    console.log('\n━━━ Agnes AI ━━━');
    await testAgnes(generateImage, mock);

    // ── ComfyUI ──
    console.log('\n━━━ ComfyUI ━━━');
    await testComfy(generateImage, mock);

  } finally {
    // Always clean up
    restoreConfig();
    console.log('\nConfig restored');
    await mock.stop();
    console.log('Mock server stopped');

    // Clean up any tmp files
    const tmpDir = path.join(ROOT, 'test', 'tmp_provider');
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });

    clearTimeout(guard);
  }

  // Summary
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  restoreConfig();
  process.exit(1);
});
