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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUITES = [
  { name: 'unit',     script: 'test/test_all.js',           critical: true },
  { name: 'contract', script: 'test/contract_all.js',       critical: true },
  { name: 'direct',   script: 'test/direct_call.js',        critical: true },
  { name: 'mcp',      script: 'test/mcp_handshake.js',      critical: true },
  { name: 'provider', script: 'test/provider_penetration.js', critical: true },
  { name: 'video',    script: 'test/video_real.js',         critical: true },
  { name: 'security', script: 'test/security_matrix.js',    critical: true },
  { name: 'sharp',    script: 'test/sharp_concurrency.js',  critical: true },
  { name: 'stability', script: 'test/stability.js',         critical: true, nodeArgs: ['--expose-gc'] },
];

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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Commercial Test Suite — Final Verdict                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Node: ${process.version} | Platform: ${process.platform}`);
  console.log('');

  const results = [];
  let criticalFailed = false;

  for (const suite of SUITES) {
    process.stdout.write(`  Running ${suite.name}...`);

    const { code, stdout, stderr } = await runSuite(suite);

    const status = code === 0 ? 'PASS' : 'FAIL';
    const icon = code === 0 ? '✓' : '✗';
    console.log(` ${icon} ${status}`);

    // Extract last lines for summary
    const output = (stdout + stderr).trim();
    const lines = output.split('\n');
    const lastLines = lines.slice(-5).join('\n');

    if (code !== 0) {
      console.log(`    ${lastLines}`);
    }

    results.push({ name: suite.name, code, critical: suite.critical, output: lastLines });

    if (code !== 0 && suite.critical) {
      criticalFailed = true;
    }
  }

  // ─── Summary ───
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Commercial Test Summary');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Suite       │ Status │ Critical');
  console.log('────────────┼────────┼─────────');

  for (const r of results) {
    const name = r.name.padEnd(11);
    const status = r.code === 0 ? '  PASS  ' : '  FAIL  ';
    const crit = r.critical ? '  YES  ' : '  no   ';
    console.log(`${name} │ ${status} │ ${crit}`);
  }

  console.log('────────────┴────────┴─────────');

  const passed = results.filter(r => r.code === 0).length;
  const failed = results.filter(r => r.code !== 0).length;

  console.log(`Passed: ${passed} / ${results.length}`);
  console.log(`Failed: ${failed} / ${results.length}`);
  console.log('');

  if (criticalFailed) {
    console.log('VERDICT: ✗ BLOCKED — Critical test(s) failed');
    console.log('         Fix failing tests before commercial release.');
  } else {
    console.log('VERDICT: ✓ READY — All critical tests pass');
  }

  process.exit(criticalFailed ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
