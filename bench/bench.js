/**
 * Performance benchmark suite for sprite-gen MCP server.
 *
 * Measures:
 *   - Average / P50 / P95 / P99 latency
 *   - Success rate
 *   - Peak RSS memory
 *   - Output sizes
 *   - Temp disk usage
 *   - Event loop delay
 *
 * Usage:
 *   node bench/bench.js
 *   node bench/bench.js --scenario single
 *   node bench/bench.js --scenario concurrency
 *   node bench/bench.js --scenario batch
 */

import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, rmSync, statSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Helpers ────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
  };
}

// ─── Event loop delay monitor ───────────────────────────────────────────────

class EventLoopMonitor {
  constructor() { this.delays = []; this._timer = null; }

  start() {
    this.delays = [];
    let last = performance.now();
    const check = () => {
      const now = performance.now();
      this.delays.push(now - last);
      last = now;
      this._timer = setTimeout(check, 10);
    };
    this._timer = setTimeout(check, 10);
  }

  stop() {
    clearTimeout(this._timer);
    this.delays.sort((a, b) => a - b);
  }

  stats() {
    return {
      p50: percentile(this.delays, 50),
      p95: percentile(this.delays, 95),
      p99: percentile(this.delays, 99),
      max: Math.max(...this.delays, 0),
    };
  }
}

// ─── Benchmark runner ───────────────────────────────────────────────────────

async function bench(name, fn, { warmup = 2, iterations = 10 } = {}) {
  const loopMon = new EventLoopMonitor();

  // Warmup
  for (let i = 0; i < warmup; i++) {
    try { await fn(); } catch (_) {}
  }

  // GC if available
  if (global.gc) global.gc();
  const memBefore = getMemoryUsage();

  loopMon.start();
  const times = [];
  let successes = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
      successes++;
    } catch (_) {}
    times.push(performance.now() - start);
  }

  loopMon.stop();
  const memAfter = getMemoryUsage();
  times.sort((a, b) => a - b);

  return {
    name,
    iterations,
    successes,
    successRate: ((successes / iterations) * 100).toFixed(0) + '%',
    avg: formatMs(times.reduce((a, b) => a + b, 0) / times.length),
    p50: formatMs(percentile(times, 50)),
    p95: formatMs(percentile(times, 95)),
    p99: formatMs(percentile(times, 99)),
    min: formatMs(times[0]),
    max: formatMs(times[times.length - 1]),
    peakRss: formatBytes(memAfter.rss),
    rssDelta: formatBytes(Math.max(0, memAfter.rss - memBefore.rss)),
    loopDelay: loopMon.stats(),
  };
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

async function scenarioSingleImage() {
  const sharp = (await import('sharp')).default;

  return [
    await bench('Sharp 512x512 PNG → 4x4 sheet', async () => {
      // Create individual tiles as sharp operations
      const tilePromises = [];
      for (let i = 0; i < 16; i++) {
        tilePromises.push(
          sharp({
            create: { width: 128, height: 128, channels: 4, background: { r: i * 16, g: 128, b: 64, alpha: 255 } },
          }).png().toBuffer()
        );
      }
      const tiles = await Promise.all(tilePromises);
      await sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite(tiles.map((buf, i) => ({
        input: buf, left: (i % 4) * 128, top: Math.floor(i / 4) * 128,
      }))).png().toBuffer();
    }, { iterations: 20 }),

    await bench('Sharp 2048x2048 PNG → 4x4 sheet', async () => {
      const tilePromises = [];
      for (let i = 0; i < 16; i++) {
        tilePromises.push(
          sharp({
            create: { width: 512, height: 512, channels: 4, background: { r: i * 16, g: 128, b: 64, alpha: 255 } },
          }).png().toBuffer()
        );
      }
      const tiles = await Promise.all(tilePromises);
      await sharp({
        create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite(tiles.map((buf, i) => ({
        input: buf, left: (i % 4) * 512, top: Math.floor(i / 4) * 512,
      }))).png().toBuffer();
    }, { iterations: 10 }),
  ];
}

async function scenarioBatchSizes() {
  const results = [];

  for (const count of [16, 64, 256]) {
    results.push(await bench(`Process ${count} frames (sharp resize)`, async () => {
      const sharp = (await import('sharp')).default;
      const tasks = [];
      for (let i = 0; i < count; i++) {
        const tile = sharp({
          create: { width: 128, height: 128, channels: 4, background: { r: i % 256, g: 128, b: 64, alpha: 255 } },
        }).resize(64, 64, { kernel: 'nearest' }).png().toBuffer();
        tasks.push(tile);
      }
      await Promise.all(tasks);
    }, { iterations: 5, warmup: 1 }));
  }

  return results;
}

async function scenarioConcurrency() {
  const results = [];
  const sharp = (await import('sharp')).default;

  for (const concurrency of [1, 2, 4, 8]) {
    results.push(await bench(`Concurrency ${concurrency} — sharp pipeline`, async () => {
      const tasks = [];
      for (let i = 0; i < concurrency; i++) {
        const p = sharp({
          create: { width: 256, height: 256, channels: 4, background: { r: i * 30, g: 128, b: 64, alpha: 255 } },
        }).resize(64, 64).png().toBuffer();
        tasks.push(p);
      }
      await Promise.all(tasks);
    }, { iterations: 20 }));
  }

  return results;
}

async function scenarioBatchGenerate() {
  const { parallelLimit } = await import('../lib/concurrency.js');

  return [
    await bench('parallelLimit: 10 tasks, concurrency=3', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => async () => {
        const sharp = (await import('sharp')).default;
        await sharp({
          create: { width: 64, height: 64, channels: 4, background: { r: i * 25, g: 128, b: 64, alpha: 255 } },
        }).resize(32, 32).png().toBuffer();
        return i;
      });
      await parallelLimit(tasks, 3);
    }, { iterations: 10 }),
  ];
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const scenario = process.argv.includes('--scenario')
    ? process.argv[process.argv.indexOf('--scenario') + 1]
    : 'all';

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        sprite-gen Performance Benchmark                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Node: ${process.version} | Platform: ${process.platform} | Arch: ${process.arch}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  const tmpDir = path.join(ROOT, 'bench', 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Ensure output dir exists
  mkdirSync(path.join(ROOT, 'output'), { recursive: true });

  const allResults = [];

  try {
    if (scenario === 'all' || scenario === 'single') {
      console.log('─── Single Image Processing ───────────────────────────────');
      const r = await scenarioSingleImage();
      allResults.push(...r);
      printTable(r);
    }

    if (scenario === 'all' || scenario === 'batch') {
      console.log('─── Batch Frame Processing ────────────────────────────────');
      const r = await scenarioBatchSizes();
      allResults.push(...r);
      printTable(r);
    }

    if (scenario === 'all' || scenario === 'concurrency') {
      console.log('─── Concurrency Scaling ──────────────────────────────────');
      const r = await scenarioConcurrency();
      allResults.push(...r);
      printTable(r);
    }

    if (scenario === 'all' || scenario === 'batch-concurrency') {
      console.log('─── Batch with parallelLimit ─────────────────────────────');
      const r = await scenarioBatchGenerate();
      allResults.push(...r);
      printTable(r);
    }

    // Summary
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('══════════════════════════════════════════════════════════════');
    printTable(allResults);

  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function printTable(results) {
  const header = ['Scenario', 'Iter', 'OK', 'Avg', 'P50', 'P95', 'P99', 'Peak RSS'];
  const rows = results.map(r => [
    r.name, r.iterations, r.successRate, r.avg, r.p50, r.p95, r.p99, r.peakRss,
  ]);

  // Calculate column widths
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));

  const line = widths.map(w => '─'.repeat(w + 2)).join('┼');
  console.log(header.map((h, i) => h.padEnd(widths[i])).join(' │ '));
  console.log(line);
  for (const row of rows) {
    console.log(row.map((v, i) => String(v).padEnd(widths[i])).join(' │ '));
  }
  console.log('');
}

main().catch(console.error);
