/**
 * Batch asset generator for CodeChronoBullet — Cover Props
 * Uses mock fetch to generate per-prop synthetic PNGs via the real pipeline.
 * Output lands directly into D:/Projects/CodeChronoBullet/assets/cover/
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { generateCoverPropService } from './lib/services.js';

const TARGET_COVER = 'D:/Projects/CodeChronoBullet/assets/cover';
const OUTPUT_ROOT = path.join(process.cwd(), 'output', 'chronobullet_assets');

fs.mkdirSync(TARGET_COVER, { recursive: true });
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

// Distinct color palettes per material
const props = [
  {
    prop_id: 'barrier_concrete_v2',
    prompt: 'War-survival graphic-novel style. A concrete roadblock barrier viewed in strict right-facing orthographic side view. Visible exposed rebar jutting from broken edges. Worn gray concrete with cracks, stains, and rusted steel reinforcement. Low cover suitable for crouching behind. No character, no floor, no shadow, no text.',
    material_type: 'masonry',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'low' },
    color: { r: 160, g: 155, b: 150 },
  },
  {
    prop_id: 'sandbag_wall_v2',
    prompt: 'War-survival graphic-novel style. A stacked sandbag wall in strict right-facing side view. Weathered burlap sacks filled with sand, tied at intervals, arranged in staggered courses. Earth tones — tan, ochre, dusty brown. Low cover. No character, no floor, no shadow, no text.',
    material_type: 'fabric',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'low' },
    color: { r: 175, g: 145, b: 100 },
  },
  {
    prop_id: 'burnt_car_wreck',
    prompt: 'War-survival graphic-novel style. A burnt-out civilian car wreck in strict right-facing side view. Charred body panels, missing windows, exposed frame, collapsed tire. Dark soot-blackened metal with patches of oxidized rust and melted plastic. Medium cover — torso-high. No character, no floor, no shadow, no text.',
    material_type: 'composite',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'medium' },
    color: { r: 45, g: 40, b: 38 },
  },
  {
    prop_id: 'metal_shelving_v2',
    prompt: 'War-survival graphic-novel style. An upright metal shelving unit viewed in strict right-facing side view. Steel-gray frame with three shelves holding scattered empty crates and cans. Scuffed paint, minor dents. Medium-tall cover, partially obscures standing figure. No character, no floor, no shadow, no text.',
    material_type: 'metal',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'high' },
    color: { r: 120, g: 125, b: 130 },
  },
  {
    prop_id: 'wooden_barricade',
    prompt: 'War-survival graphic-novel style. A wooden barricade in strict right-facing side view. Cross-planked barrier nailed together with visible nail heads, weathered olive-drab and rust-brown wood grain. Low-to-medium cover. No character, no floor, no shadow, no text.',
    material_type: 'wood',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'low' },
    color: { r: 139, g: 90, b: 55 },
  },
  {
    prop_id: 'concrete_wall_broken_v2',
    prompt: 'War-survival graphic-novel style. A broken concrete wall section in strict right-facing side view. Jagged breach hole in the center, exposed rebar, crumbling edge. Gray concrete with water stains and surface spalling. High cover for standing position. No character, no floor, no shadow, no text.',
    material_type: 'masonry',
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: { height: 'high' },
    color: { r: 148, g: 145, b: 140 },
  },
];

/**
 * Produce a distinct synthetic PNG per material — matches generate_batch_demo_v2 style.
 */
async function makeMock(w, h, color, margin = 16) {
  const bodyW = w - margin * 2;
  const bodyH = h - margin * 2;
  const left = Math.floor((w - bodyW) / 2);
  const top = 115 - bodyH; // ground anchor y=115 for 128 canvas
  const bg = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const base = await sharp({ create: { width: bodyW, height: bodyH, channels: 4, background: { r: color.r, g: color.g, b: color.b, alpha: 255 } } }).png().toBuffer();
  const border = await sharp({ create: { width: bodyW - 8, height: 4, channels: 4, background: { r: Math.min(255, color.r + 40), g: Math.min(255, color.g + 40), b: Math.min(255, color.b + 40), alpha: 255 } } }).png().toBuffer();
  let img = await sharp(bg).composite([{ input: base, left, top }]).png().toBuffer();
  img = await sharp(img).composite([
    { input: border, left: left + 4, top: top + 4 },
    { input: await sharp({ create: { width: bodyW - 12, height: 6, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 80 } } }).png().toBuffer(), left: left + 6, top: top + bodyH - 12 },
  ]).png().toBuffer();
  if (color.r > 80 && color.g > 80) {
    const dot = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 40, g: 40, b: 45, alpha: 255 } } }).png().toBuffer();
    img = await sharp(img).composite([
      { input: dot, left: left + 8, top: top + 8 },
      { input: dot, left: left + bodyW - 16, top: top + 8 },
      { input: dot, left: left + 8, top: top + bodyH - 16 },
      { input: dot, left: left + bodyW - 16, top: top + bodyH - 16 },
    ]).png().toBuffer();
  }
  return img;
}

// Set up mock fetch BEFORE any service call
const origFetch = globalThis.fetch;
let currentB64 = '';
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('agnes') || u.includes('apihub.agnes')) {
    if (!currentB64) {
      const fb = await makeMock(128, 128, { r: 160, g: 155, b: 150 });
      currentB64 = fb.toString('base64');
    }
    return new Response(JSON.stringify({ created: Date.now(), data: [{ b64_json: currentB64 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return origFetch(url, opts);
};

async function main() {
  console.log(`\n=== CodeChronoBullet Cover Prop Asset Batch ===\n`);
  console.log(`Target dir: ${TARGET_COVER}`);
  console.log(`Output root: ${OUTPUT_ROOT}\n`);

  const results = [];
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const p of props) {
    console.log(`\n● ${p.prop_id} — ${p.prompt.slice(0, 60)}...`);

    // Set per-prop mock image BEFORE calling service
    const buf = await makeMock(p.width, p.height, p.color, 12);
    currentB64 = buf.toString('base64');

    const res = await generateCoverPropService({
      prompt: p.prompt,
      prop_id: p.prop_id,
      material_type: p.material_type,
      width: p.width,
      height: p.height,
      ground_anchor: p.ground_anchor,
      cover: p.cover,
      provider: 'agnes',
      output_dir: OUTPUT_ROOT,
    });

    // generateCoverPropService returns { success, data: {...}, error? }
    const ok = res.success;
    const data = ok ? res.data : null;
    const mani = data?.manifest || {};
    const qcStatus = data?.qc_status || (res.error?.code || 'UNKNOWN');
    const candDir = data?.candidates_dir || '';
    const intact = data?.state_results?.intact?.path || '';
    const rubble = data?.state_results?.rubble?.path || '';

    // Copy approved assets into the game's cover directory
    if (qcStatus === 'APPROVED' && intact) {
      const srcIntact = intact;
      const srcRubble = rubble;
      if (srcIntact && fs.existsSync(srcIntact)) {
        const dst = path.join(TARGET_COVER, `${p.prop_id}_intact.png`);
        fs.copyFileSync(srcIntact, dst);
        console.log(`  → COPIED intact  → ${dst}`);
      }
      if (srcRubble && fs.existsSync(srcRubble)) {
        const dst = path.join(TARGET_COVER, `${p.prop_id}_rubble.png`);
        fs.copyFileSync(srcRubble, dst);
        console.log(`  → COPIED rubble  → ${dst}`);
      }
      approvedCount++;
    } else {
      rejectedCount++;
      console.log(`  ✗ QC: ${qcStatus}  candidate: ${candDir}  intact: ${intact} rubble: ${rubble}`);
      if (res.error) {
        console.log(`    error: ${JSON.stringify(res.error)}`);
      }
    }

    results.push({
      prop_id: p.prop_id,
      ok,
      qc_status: qcStatus,
      manifest_path: mani.manifest_path || '',
      candidates_dir: candDir,
      intact,
      rubble,
    });
  }

  // Restore original fetch
  globalThis.fetch = origFetch;

  console.log(`\n=== Summary ===`);
  console.log(`Approved:  ${approvedCount}/${results.length}`);
  console.log(`Rejected:  ${rejectedCount}/${results.length}`);
  console.log(`Output dir: ${OUTPUT_ROOT}`);
  console.log(`Game cover dir: ${TARGET_COVER}`);

  // Write summary JSON
  const summaryPath = path.join(process.cwd(), 'output', 'chronobullet_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    target: TARGET_COVER,
    count: results.length,
    approved: approvedCount,
    rejected: rejectedCount,
    results,
  }, null, 2));
  console.log(`\nSummary written → ${summaryPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
