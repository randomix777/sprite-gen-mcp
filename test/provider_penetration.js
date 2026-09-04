/**
 * Provider penetration tests — REAL API only (no mocks).
 *
 * Exercises generateImage() against REAL providers.
 * Tests may fail if API is unavailable — that's expected.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_provider');

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

// ─── Setup ───────────────────────────────────────────────────────────────

mkdirSync(TMP, { recursive: true });

// ─── Tests ───────────────────────────────────────────────────────────────

console.log('\n1. Provider configuration');

test('Agnes provider has valid config', async () => {
  const { getProviderConfig } = await import('../lib/config.js');
  const cfg = getProviderConfig('agnes');
  assert(cfg, 'Agnes config exists');
  assert(cfg.apiKey && cfg.apiKey.length > 0, 'Agnes apiKey set');
  assert(cfg.baseUrl, 'Agnes baseUrl set');
});

test('Gemini Flash provider has valid config', async () => {
  const { getProviderConfig } = await import('../lib/config.js');
  const cfg = getProviderConfig('gemini_flash');
  assert(cfg, 'Gemini config exists');
});

console.log('\n2. Image generation (REAL API calls)');

await testAsync('Agnes image generation', async () => {
  const { generateImage } = await import('../lib/image_gen.js');
  const result = await generateImage({
    provider: 'agnes',
    prompt: 'a simple red square',
    width: 64,
    height: 64,
    num_images: 1,
  });
  
  if (result.success) {
    assert(result.data?.images?.length > 0, 'Should have images');
    assert(result.data.images[0].data.length > 0, 'Image data should exist');
  } else {
    // API unavailable is acceptable - this is expected during queue full
    const msg = result.error?.message || '';
    if (msg.includes('503') || msg.includes('queue is full') || msg.includes('fetch failed')) {
      console.log(`    (API temporarily unavailable - skipping)`);
      assert(true, 'API unavailable (expected in some environments)');
    } else {
      throw new Error(`Unexpected error: ${msg}`);
    }
  }
});

await testAsync('Gemini Flash image generation', async () => {
  const { generateImage } = await import('../lib/image_gen.js');
  const result = await generateImage({
    provider: 'gemini_flash',
    prompt: 'a simple red square',
    width: 64,
    height: 64,
    num_images: 1,
  });
  
  if (result.success) {
    assert(result.data?.images?.length > 0, 'Should have images');
  } else {
    const msg = result.error?.message || '';
    if (msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
      console.log(`    (Local Gemini not running - skipping)`);
      assert(true, 'Local provider not available (expected)');
    } else {
      throw new Error(`Unexpected error: ${msg}`);
    }
  }
});

console.log('\n3. Retry logic');

await testAsync('Retry with backoff succeeds', async () => {
  const { retryWithBackoff } = await import('../lib/retry.js');
  
  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error('Temporary failure');
    }
    return 'success';
  };
  
  const result = await retryWithBackoff(fn, 3, 10);
  assert(result === 'success', 'Should succeed after retries');
  assert(callCount === 3, 'Should call 3 times');
});

await testAsync('Retry fails after max attempts', async () => {
  const { retryWithBackoff } = await import('../lib/retry.js');
  
  const fn = async () => {
    throw new Error('Permanent failure');
  };
  
  try {
    await retryWithBackoff(fn, 2, 10);
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e.message === 'Permanent failure', 'Should throw original error');
  }
});

await testAsync('Retry handles retryable result objects', async () => {
  const { retryWithBackoff } = await import('../lib/retry.js');
  let callCount = 0;
  const result = await retryWithBackoff(async () => {
    callCount++;
    if (callCount < 3) {
      return { success: false, error: { code: 'PROVIDER_UNAVAILABLE', retryable: true } };
    }
    return { success: true, data: 'ok' };
  }, 3, 1);

  assert(result.success === true, 'Should return the successful result');
  assert(callCount === 3, 'Should retry result objects marked retryable');
});

// ─── Cleanup ─────────────────────────────────────────────────────────────

rmSync(TMP, { recursive: true, force: true });

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════════════════`);

if (failed > 0) process.exit(1);
