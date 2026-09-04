/**
 * Godot path resolution test suite.
 *
 * Tests the unified Godot executable resolver in lib/godot.js:
 * - Priority order (explicit > config > env > PATH > Windows scan)
 * - Version detection (must report Godot 4.x)
 * - Config persistence and restoration
 * - Error handling for invalid paths
 */
import { resolveGodot, getGodotStatus } from '../lib/godot.js';
import { loadConfig, saveConfig, setGodotConfig, getGodotConfig } from '../lib/config.js';
import { emitReport } from './_report.js';

const __startedAt = Date.now();
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  ✗ ${msg}`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}
function assertType(val, type, msg) {
  if (typeof val !== type) { failed++; console.log(`  ✗ ${msg} (got ${typeof val})`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}
function assertNotNull(val, msg) {
  if (val === null || val === undefined) { failed++; console.log(`  ✗ ${msg} (got null/undefined)`); }
  else { passed++; console.log(`  ✓ ${msg}`); }
}

console.log('\nGodot Path Resolution Tests\n');

// ─── 1. Default resolution (no config, no env) ─────────────────────────────────
console.log('1. Default resolution behavior');
{
  const result = resolveGodot();
  assertType(result, 'object', 'Result is an object');
  assertType(result.available, 'boolean', 'Has available flag');
  // executable can be string (found) or null (not found)
  assert(result.executable === null || typeof result.executable === 'string', 'Executable is string or null');
  assertType(result.note, 'string', 'Has note');
  // Either found or explicitly not found
  assert(
    result.available === true || result.available === false,
    'available is a definite boolean'
  );
}

// ─── 2. Explicit parameter takes highest priority ──────────────────────────────
console.log('\n2. Explicit parameter priority');
{
  // Use non-existent path to confirm it's checked but rejected
  const result = resolveGodot({ godot_executable: 'C:\\\\nonexistent\\\\godot.exe' });
  assert(result.available === false, 'Non-existent explicit path is rejected');
  assert(result.note.includes('not valid'), 'Note explains rejection');
}

// ─── 3. Config persistence ──────────────────────────────────────────────────────
console.log('\n3. Config persistence');
{
  const originalConfig = getGodotConfig();
  
  // Save a test config
  setGodotConfig({ executablePath: 'D:\\\\test_godot.exe', requireForPublish: true });
  const savedConfig = getGodotConfig();
  assert(savedConfig.executablePath === 'D:\\\\test_godot.exe', 'Config persists executablePath');
  assert(savedConfig.requireForPublish === true, 'Config persists requireForPublish');
  
  // Restore original
  setGodotConfig(originalConfig);
  const restoredConfig = getGodotConfig();
  assert(restoredConfig.executablePath === originalConfig.executablePath, 'Config can be restored');
}

// ─── 4. Invalid config values are rejected ─────────────────────────────────────
console.log('\n4. Invalid config validation');
{
  const { validateGodotConfig } = await import('../lib/config.js');
  
  const invalid1 = validateGodotConfig({ executablePath: 123 });
  assert(!invalid1.valid, 'Non-string executablePath is invalid');
  assert(invalid1.errors.length > 0, 'Returns errors for invalid config');
  
  const invalid2 = validateGodotConfig({ requireForPublish: 'yes' });
  assert(!invalid2.valid, 'Non-boolean requireForPublish is invalid');
  
  const valid = validateGodotConfig({ executablePath: 'D:\\\\Godot.exe', requireForPublish: true });
  assert(valid.valid, 'Valid config passes validation');
}

// ─── 5. getGodotStatus consistency ─────────────────────────────────────────────
console.log('\n5. getGodotStatus consistency');
{
  const status = getGodotStatus();
  assertType(status.available, 'boolean', 'Status has available');
  assert(status.executable === null || typeof status.executable === 'string', 'Status executable is string or null');
  assert(status.version === null || typeof status.version === 'string', 'Status version is string or null');
  assertType(status.note, 'string', 'Status has note');
}

// ─── 6. ENV GODOT4_BIN override ───────────────────────────────────────────────
console.log('\n6. Environment variable override');
{
  const original = process.env.GODOT4_BIN;
  
  // Set invalid path
  process.env.GODOT4_BIN = 'C:\\\\env_test\\\\godot.exe';
  const envResult = resolveGodot();
  assert(envResult.available === false, 'Invalid ENV path is rejected');
  
  // Clear ENV
  delete process.env.GODOT4_BIN;
  const clearedResult = resolveGodot();
  // After clearing, resolution should either find Godot or report unavailable
  assert(clearedResult.available !== true || clearedResult.executable !== 'C:\\\\env_test\\\\godot.exe',
    'Clearing ENV removes the invalid path');
  
  // Restore
  if (original) process.env.GODOT4_BIN = original;
}

// ─── 7. Version string contains "4." ──────────────────────────────────────────
console.log('\n7. Version detection');
{
  const status = getGodotStatus();
  if (status.available) {
    assert(status.version && /4\./.test(status.version), 'Version contains "4."');
  } else {
    assert(status.version === null || !status.version, 'No version when unavailable');
  }
}

// ─── 8. Resolve returns consistent structure ───────────────────────────────────
console.log('\n8. Result structure consistency');
{
  const result = resolveGodot();
  const keys = Object.keys(result);
  assert(keys.includes('available'), 'Result has "available"');
  assert(keys.includes('executable'), 'Result has "executable"');
  assert(keys.includes('version'), 'Result has "version"');
  assert(keys.includes('note'), 'Result has "note"');
}

// ─── 9. Empty/null inputs handled gracefully ───────────────────────────────────
console.log('\n9. Edge case handling');
{
  const result1 = resolveGodot({ godot_executable: '' });
  assert(result1.available === false, 'Empty string is rejected');
  
  const result2 = resolveGodot({ godot_executable: null });
  assert(result2.available !== true || result2.executable === null, 'Null is handled');
  
  const result3 = resolveGodot(undefined);
  assert(result3 !== null, 'Undefined input returns object');
}

// ─── 10. Config round-trip ─────────────────────────────────────────────────────
console.log('\n10. Config round-trip');
{
  const testPath = 'D:\\\\Godot_v4.7.2-stable_win64_console.exe';
  setGodotConfig({ executablePath: testPath, requireForPublish: false });
  const config = getGodotConfig();
  assert(config.executablePath === testPath, 'Path preserved through round-trip');
  assert(config.requireForPublish === false, 'Boolean preserved through round-trip');
  
  // Clean up
  setGodotConfig({ executablePath: null, requireForPublish: true });
}

console.log(`\nGODOT RESOLUTION RESULTS: ${passed} passed, ${failed} failed`);
emitReport('godot_resolution', { assertions: passed + failed, passed, failed, skipped: 0, startedAt: __startedAt });
process.exit(failed > 0 ? 1 : 0);
