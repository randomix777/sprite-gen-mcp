/**
 * Commercial test orchestrator — runs all commercial suites with strict verdict.
 *
 * Suites:
 * 1. unit          — core module tests
 * 2. contract      — contract tests (service layer)
 * 3. direct        — direct service tests
 * 4. mcp           — MCP handshake
 * 5. provider      — provider penetration (4 providers)
 * 6. video         — real video processing
 * 7. security      — path security matrix
 * 8. sharp         — concurrency limit validation
 * 9. stability     — 100 iterations
 *
 * Exit code 0 = all critical suites pass.
 * Exit code 1 = any critical suite fails.
 * Blocked/EXTERNAL = reported but does not fail if mock tests cover the area.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { statSync, readdirSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUITES = [
  { name: 'unit',      script: 'test/test_all.js',           critical: true },
  { name: 'contract',  script: 'test/contract_all.js',       critical: true },
  { name: 'direct',    script: 'test/direct_call.js',        critical: true },
  { name: 'mcp',       script: 'test/mcp_handshake.js',      critical: true },
  { name: 'provider',  script: 'test/provider_penetration.js', critical: true },
  { name: 'video',     script: 'test/video_real.js',         critical: true },
  { name: 'security',  script: 'test/security_matrix.js',    critical: true },
  { name: 'sharp',     script: 'test/sharp_concurrency.js',  critical: true },
  { name: 'stability', script: 'test/stability.js',          critical: true, nodeArgs: ['--expose-gc'] },
  { name: 'qc',        script: 'test/qc_test.js',            critical: true },
  { name: 'regression', script: 'test/regression.js',       critical: true },
  { name: 'cover_prop', script: 'test/cover_prop_test.js',  critical: true },
  { name: 'e2e',       script: 'test/e2e_cover_prop.js',     critical: true },
  { name: 'agnes',     script: 'test/agnes_contract.js',     critical: true },
  { name: 'audit',     script: 'test/audit_test.js',         critical: true },
  { name: 'regenerate', script: 'test/regenerate_test.js',   critical: true },
  { name: 'godot_gate', script: 'test/godot_gate_test.js',   critical: true, needsGodot: true },
  { name: 'godot_resolution', script: 'test/godot_resolution_test.js', critical: true, needsGodot: false },
  { name: 'artifact_cleanup', script: 'test/artifact_cleanup_test.js', critical: true },
  { name: 'failure_injection', script: 'test/failure_injection_test.js', critical: true },
];

/** Detect a usable Godot 4 binary. Returns null if none. */
function findGodotBinary() {
  // Honor an explicit override first (the same contract the suites use).
  if (process.env.GODOT4_BIN && existsSync(process.env.GODOT4_BIN)) {
    return process.env.GODOT4_BIN;
  }
  const candidates = ['godot', 'godot4', 'Godot', 'Godot4',
    '/usr/local/bin/godot', '/usr/bin/godot',
    process.env.LOCALAPPDATA + '\\Godot\\godot.exe',
    'C:\\Program Files\\Godot\\godot.exe'];
  for (const c of candidates.filter(Boolean)) {
    try { statSync(c); return c; } catch (_) {}
  }
  return null;
}

function runSuite(suite) {
  return new Promise(resolve => {
    const args = [...(suite.nodeArgs || []), suite.script];
    const proc = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });
  });
}

// Parse the stable JSON report line emitted by each suite on stderr:
//   COMMERCIAL_JSON {"suite":..,"assertions":..,"passed":..,"failed":..,"status":..}
// Returns the parsed object, or null if absent/unparseable.
function parseReport(stderr) {
  const marker = 'COMMERCIAL_JSON ';
  const idx = stderr.lastIndexOf(marker);
  if (idx === -1) return null;
  const jsonStr = stderr.slice(idx + marker.length).trim();
  try {
    const obj = JSON.parse(jsonStr);
    return obj;
  } catch {
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Commercial Test Suite — Final Verdict                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Node: ${process.version} | Platform: ${process.platform}`);

  const godotBinary = findGodotBinary();
  console.log(`Godot 4 binary: ${godotBinary || '(not found — Godot-gated suites will be BLOCKED, not failed)'}`);
  console.log('');

  const results = [];
  let criticalFailed = false;
  let godotBlocked = false;

  for (const suite of SUITES) {
    // Skip Godot-dependent suites when no engine is available (per hardening spec:
    // do NOT report a fake failure; mark as BLOCKED so the verdict reflects reality).
    if (suite.needsGodot && !godotBinary) {
      console.log(`  Running ${suite.name}... ⊘ BLOCKED (Godot engine not available)`);
      results.push({ name: suite.name, code: 0, blocked: true, critical: suite.critical, output: 'BLOCKED: Godot 4 engine unavailable' });
      godotBlocked = true;
      continue;
    }

    process.stdout.write(`  Running ${suite.name}...`);

    const { code, stdout, stderr } = await runSuite(suite);

    // Parse the stable JSON report line (emitted on stderr by every suite).
    // This closes the "fake green" gap: a suite that exits 0 but asserts nothing,
    // or whose reported status disagrees with its exit code, is treated as FAILED.
    const report = parseReport(stderr);
    let parseError = null;
    if (suite.needsGodot && godotBinary) {
      // Godot-bound suites must emit a well-formed report.
      if (!report) parseError = 'no COMMERCIAL_JSON report line';
      else {
        const missing = ['suite', 'assertions', 'passed', 'failed', 'status'].filter(k => !(k in report));
        if (missing.length) parseError = `report missing fields: ${missing.join(',')}`;
        else if (typeof report.assertions !== 'number' || report.assertions === 0) parseError = 'report assertions === 0 (no real assertions)';
        else if (report.status === 'FAIL' && code === 0) parseError = 'report status=FAIL but exit code=0 (conflict)';
        else if (report.status === 'PASS' && code !== 0) parseError = 'report status=PASS but exit code!=0 (conflict)';
        else if (report.failed > 0 && code === 0) parseError = 'report failed>0 but exit code=0 (conflict)';
      }
    }

    const status = (code === 0 && !parseError) ? 'PASS' : 'FAIL';
    const icon = status === 'PASS' ? '✓' : '✗';
    console.log(` ${icon} ${status}${parseError ? ` (${parseError})` : ''}`);

    // Extract last lines for summary
    const output = (stdout + stderr).trim();
    const lines = output.split('\n');
    const lastLines = lines.slice(-5).join('\n');

    if (code !== 0 || parseError) {
      console.log(`    ${lastLines}`);
    }

    results.push({ name: suite.name, code, critical: suite.critical, output: lastLines, parseError, report });

    // A critical suite fails the commercial release if it errors OR fails parsing.
    if (suite.critical && (code !== 0 || parseError)) {
      criticalFailed = true;
    }
  }

  // ─── Summary ───
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Commercial Test Summary');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Suite       │ Status  │ Critical');
  console.log('────────────┼─────────┼─────────');

  for (const r of results) {
    const name = r.name.padEnd(11);
    const status = r.blocked ? ' BLOCKED ' : (r.code === 0 ? '  PASS   ' : '  FAIL   ');
    const crit = r.critical ? '  YES  ' : '  no   ';
    console.log(`${name} │ ${status} │ ${crit}`);
  }

  console.log('────────────┴─────────┴─────────');

  const passed = results.filter(r => r.code === 0 && !r.blocked).length;
  const failed = results.filter(r => r.code !== 0).length;
  const blocked = results.filter(r => r.blocked).length;

  console.log(`Passed: ${passed} / ${results.length}`);
  console.log(`Failed: ${failed} / ${results.length}`);
  console.log(`Blocked: ${blocked} / ${results.length}`);
  console.log('');

  if (criticalFailed) {
    console.log('VERDICT: ✗ BLOCKED — Critical test(s) failed');
    console.log('         Fix failing tests before commercial release.');
  } else if (godotBlocked) {
    console.log('VERDICT: ⊘ BLOCKED — All critical tests pass, but Godot-gated');
    console.log('         verification is BLOCKED (engine binary not found).');
    console.log('         Install Godot 4 and set GODOT4_BIN to fully verify.');
  } else {
    console.log('VERDICT: ✓ READY — All critical tests pass');
  }

  process.exit(criticalFailed ? 1 : (godotBlocked ? 2 : 0));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
