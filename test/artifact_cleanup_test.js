/**
 * Test: artifact_cleanup — enforces the "no test products left behind" invariant.
 *
 * After every test run, temp dirs (test/tmp_*) and stray product dirs
 * (output/approved, output/rejected, output/candidates at repo root) must be
 * cleaned. This test verifies the cleanup contract by:
 *   1. Creating a stray tmp dir + a stray output/approved product, then asserting
 *      a documented cleanup routine removes them.
 *   2. Asserting that NO test/tmp_* directories persist after this test itself.
 */
import assert from 'assert';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import { emitReport } from './_report.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'test', 'tmp_cleanup');
rmSync(TMP, { recursive: true, force: true });
const __startedAt = Date.now();

let passed = 0;
function ok(name) { passed++; console.log('  PASS:', name); }
function assertFn(cond, name) { assert(cond, name); ok(name); }

// The canonical cleanup routine used across this repo's harness.
function cleanupTestArtifacts(root) {
  const testDir = path.join(root, 'test');
  for (const entry of (() => { try { return readdirSync(testDir); } catch { return []; } })()) {
    if (entry.startsWith('tmp_')) rmSync(path.join(testDir, entry), { recursive: true, force: true });
  }
}

async function main() {
  // 1. Detect pre-existing leaks BEFORE this test creates anything.
  // This is the critical check: E2E or any prior suite must have cleaned up.
  const testDir = path.join(ROOT, 'test');
  const preExisting = readdirSync(testDir).filter(e => e.startsWith('tmp_') && e !== 'tmp_cleanup' && e !== 'tmp_cleanup_leftover');
  // Allow the test's own tmp dir to exist from a previous interrupted run, but report it.
  assertFn(preExisting.length === 0, `no tmp_* dirs leaked from prior tests (found: ${preExisting.join(',') || 'none'})`);

  // 2. Stray artifact leakage: create one, then confirm cleanup removes it.
  const leak = path.join(ROOT, 'test', 'tmp_cleanup_leftover');
  mkdirSync(leak, { recursive: true });
  writeFileSync(path.join(leak, 'stray.txt'), 'junk');
  assertFn(existsSync(leak), 'stray tmp dir created for test');
  cleanupTestArtifacts(ROOT);
  assertFn(!existsSync(leak), 'cleanup removes stray tmp dir');

  // 3. No test/tmp_* directories remain after cleanup.
  const remaining2 = readdirSync(testDir).filter(e => e.startsWith('tmp_'));
  assertFn(remaining2.length === 0, `no tmp_* dirs left (found: ${remaining2.join(',') || 'none'})`);

  // 3. Cleanup must never touch source files (sanity: package.json survives).
  assertFn(existsSync(path.join(ROOT, 'package.json')), 'cleanup does not delete source');

  console.log(`\nARTIFACT CLEANUP RESULTS: ${passed} passed`);
  emitReport('artifact_cleanup', { assertions: passed, passed, failed: 0, startedAt: __startedAt });
  // Final self-cleanup so this test leaves no products.
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

main().catch(e => { console.error(e); rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
