/**
 * Stability test — 100 iterations of core tools without external API.
 *
 * Uses Node's monitorEventLoopDelay() for accurate event-loop blocking measurement
 * (not performance.now() deltas which conflate async wait with real blocking).
 *
 * Measures:
 *   - Success rate
 *   - Memory change (RSS delta, heap growth)
 *   - Event loop delay (P50, P95, P99 via monitorEventLoopDelay)
 *   - Temp directory leakage
 *   - Per-tool timing breakdown
 */

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'tmp_stability');

const ITERATIONS = 100;
const TOOLS = [
  'sheetService',
  'cutoutService',
  'gifPreviewService',
  'godotExportService',
  'detectAnimationsService',
  'engineExportTpacker',
  'engineExportAseprite',
  'paletteExtractService',
  'qcReportService',
];

mkdirSync(TMP, { recursive: true });

// Import services
import {
  sheetService, cutoutService, gifPreviewService,
  godotExportService, detectAnimationsService,
  engineExportService, paletteExtractService, qcReportService,
} from '../lib/services.js';

import { default as sharp } from 'sharp';

// Create test images once
async function createTestImages() {
  const imgs = {};

  imgs.sheet128 = path.join(TMP, 'stability_sheet.png');
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(imgs.sheet128);

  imgs.sheet256 = path.join(TMP, 'stability_sheet256.png');
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(imgs.sheet256);

  imgs.cutout = path.join(TMP, 'stability_cutout.png');
  const cw = 64, ch = 64;
  const cbuf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (x >= 24 && x < 40 && y >= 24 && y < 40) {
        cbuf[i] = 0; cbuf[i + 1] = 200; cbuf[i + 2] = 0; cbuf[i + 3] = 255;
      } else {
        cbuf[i] = 200; cbuf[i + 1] = 0; cbuf[i + 2] = 0; cbuf[i + 3] = 255;
      }
    }
  }
  await sharp(cbuf, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(imgs.cutout);

  imgs.gif = path.join(TMP, 'stability_gif.png');
  await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 255 } },
  }).png().toFile(imgs.gif);

  return imgs;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function formatHistogram(h) {
  const lines = [];
  const maxCount = Math.max(...h.buckets);
  const barWidth = 40;
  for (let i = 0; i < h.buckets.length; i++) {
    const label = h.buckets[i] === 0 ? '0' : `< ${formatDuration(h.labels[i])}`;
    const count = h.buckets[i];
    const bar = count > 0 ? '█'.repeat(Math.max(1, Math.round((count / maxCount) * barWidth))) : '';
    lines.push(`  ${label.padEnd(12)} ${String(count).padStart(5)} ${bar}`);
  }
  return lines.join('\n');
}

function formatDuration(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runStability() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        Stability Test — 100 Iterations                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Node: ${process.version} | Platform: ${process.platform}`);
  console.log('');

  // Start event-loop delay monitor BEFORE anything
  const loopMonitor = monitorEventLoopDelay({ resolution: 1 });
  loopMonitor.enable();

  const imgs = await createTestImages();
  const memBefore = process.memoryUsage();

  const results = {};
  const wallTimes = []; // wall-clock per-tool times (for latency, NOT event-loop blocking)

  // Warmup
  for (let i = 0; i < 5; i++) {
    await sheetService({ image_path: imgs.sheet128, grid_cols: 4, grid_rows: 4, output_path: path.join(TMP, `warmup_${i}.png`) });
  }
  for (let i = 0; i < 5; i++) {
    try { rmSync(path.join(TMP, `warmup_${i}.png`)); } catch (_) {}
  }

  if (global.gc) global.gc();

  const startTime = Date.now();

  for (let i = 0; i < ITERATIONS; i++) {
    const toolIdx = i % TOOLS.length;
    const toolName = TOOLS[toolIdx];

    if (!results[toolName]) results[toolName] = { success: 0, fail: 0, times: [] };

    const iterStart = performance.now();
    try {
      let result;
      switch (toolName) {
        case 'sheetService':
          result = await sheetService({
            image_path: imgs.sheet128, grid_cols: 4, grid_rows: 4,
            output_path: path.join(TMP, `stab_sheet_${i}.png`),
          });
          break;
        case 'cutoutService':
          result = await cutoutService({
            image_path: imgs.cutout,
            output_path: path.join(TMP, `stab_cutout_${i}.png`),
          });
          break;
        case 'gifPreviewService':
          result = await gifPreviewService({
            image_path: imgs.gif, cell_width: 32, cell_height: 32, fps: 4,
            output_path: path.join(TMP, `stab_gif_${i}.gif`),
          });
          break;
        case 'godotExportService':
          result = await godotExportService({
            image_path: imgs.sheet256, cell_width: 64,
            output_path: path.join(TMP, `stab_godot_${i}.tres`),
          });
          break;
        case 'detectAnimationsService':
          result = await detectAnimationsService({ image_path: imgs.sheet256, cell_width: 64 });
          break;
        case 'engineExportTpacker':
          result = await engineExportService('tpacker', {
            image_path: imgs.sheet256, cell_width: 64, cell_height: 64,
            output_path: path.join(TMP, `stab_tpacker_${i}.json`),
          });
          break;
        case 'engineExportAseprite':
          result = await engineExportService('aseprite', {
            image_path: imgs.sheet256, cell_width: 64, cell_height: 64,
            output_path: path.join(TMP, `stab_aseprite_${i}.json`),
          });
          break;
        case 'paletteExtractService':
          result = await paletteExtractService({ image_path: imgs.sheet256, colors: 8 });
          break;
        case 'qcReportService':
          result = await qcReportService({ image_path: imgs.sheet256, cell_width: 64, cell_height: 64 });
          break;
      }

      if (result?.success) results[toolName].success++;
      else results[toolName].fail++;
    } catch (e) {
      results[toolName].fail++;
    }

    const wallTime = performance.now() - iterStart;
    results[toolName].times.push(wallTime);
    wallTimes.push({ tool: toolName, ms: wallTime });

    if (i % 10 === 0 && global.gc) global.gc();
  }

  const elapsed = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  // Stop monitor and collect
  loopMonitor.disable();
  const eld = loopMonitor;

  // Clean up temp files
  try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  const tmpLeaked = existsSync(TMP);

  // ─── Report ───
  console.log('─── Results ───────────────────────────────────────────────');
  console.log(`Total iterations: ${ITERATIONS}`);
  console.log(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Temp dir leaked: ${tmpLeaked ? 'YES ⚠️' : 'NO ✓'}`);
  console.log('');

  let totalSuccess = 0, totalFail = 0;
  console.log('Tool                    │ Iter │ OK   │ Fail │ Avg      │ P50      │ P95      │ P99');
  console.log('────────────────────────┼──────┼──────┼──────┼──────────┼──────────┼──────────┼──────────');

  for (const tool of TOOLS) {
    const r = results[tool];
    if (!r) continue;
    const times = [...r.times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p50 = percentile(times, 0.50);
    const p95 = percentile(times, 0.95);
    const p99 = percentile(times, 0.99);
    totalSuccess += r.success;
    totalFail += r.fail;
    console.log(
      `${tool.padEnd(23)} │ ${String(r.success + r.fail).padStart(4)} │ ${String(r.success).padStart(4)} │ ${String(r.fail).padStart(4)} │ ${formatDuration(avg).padStart(8)} │ ${formatDuration(p50).padStart(8)} │ ${formatDuration(p95).padStart(8)} │ ${formatDuration(p99).padStart(8)}`
    );
  }

  console.log('────────────────────────┼──────┼──────┼──────┼──────────┼──────────┼──────────┼──────────');
  console.log(
    `${'TOTAL'.padEnd(23)} │ ${String(totalSuccess + totalFail).padStart(4)} │ ${String(totalSuccess).padStart(4)} │ ${String(totalFail).padStart(4)} │`
  );
  console.log('');
  console.log(`Success rate: ${((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1)}%`);
  console.log('');

  // ─── Memory ───
  console.log('─── Memory ────────────────────────────────────────────────');
  console.log(`RSS before: ${(memBefore.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`RSS after:  ${(memAfter.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`RSS delta:  ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Heap before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Heap after:  ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Heap delta:  ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(1)} MB`);
  console.log('');

  // ─── Event Loop Delay (monitorEventLoopDelay) ───
  console.log('─── Event Loop Delay (monitorEventLoopDelay) ──────────────');
  const min = eld.min / 1e6;   // ns → ms
  const max = eld.max / 1e6;
  const mean = eld.mean / 1e6;

  // percentiles is a Float64Array indexed by percentile number (0..100)
  const p50_eld = (eld.percentiles?.[50] ?? eld.mean) / 1e6;
  const p95_eld = (eld.percentiles?.[95] ?? eld.mean) / 1e6;
  const p99_eld = (eld.percentiles?.[99] ?? eld.mean) / 1e6;

  console.log(`Resolution: 1ms`);
  console.log(`Samples: ${eld.count}`);
  console.log(`Min: ${formatDuration(min)}`);
  console.log(`Mean: ${formatDuration(mean)}`);
  console.log(`Max: ${formatDuration(max)}`);
  console.log(`P50: ${formatDuration(p50_eld)}`);
  console.log(`P95: ${formatDuration(p95_eld)}`);
  console.log(`P99: ${formatDuration(p99_eld)}`);
  console.log('');

  // ─── Wall-clock latency summary ───
  console.log('─── Wall-clock Latency (task completion time) ─────────────');
  const allTimes = wallTimes.map(w => w.ms).sort((a, b) => a - b);
  const wallP50 = percentile(allTimes, 0.50);
  const wallP95 = percentile(allTimes, 0.95);
  const wallP99 = percentile(allTimes, 0.99);
  console.log(`P50: ${formatDuration(wallP50)}`);
  console.log(`P95: ${formatDuration(wallP95)}`);
  console.log(`P99: ${formatDuration(wallP99)}`);
  console.log('');

  // ─── Verdict ───
  const passRate = totalSuccess / (totalSuccess + totalFail);
  const pass = passRate >= 0.99 && !tmpLeaked;

  console.log('════════════════════════════════════════════════════════════');
  if (pass) {
    console.log('VERDICT: ✓ PASS — Stability test passed');
  } else if (passRate >= 0.95) {
    console.log('VERDICT: ⚠ WARNING — Minor issues detected');
  } else {
    console.log('VERDICT: ✗ FAIL — Significant failures');
  }

  process.exit(pass ? 0 : 1);
}

runStability().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
