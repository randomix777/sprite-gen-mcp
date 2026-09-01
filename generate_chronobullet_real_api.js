/**
 * Batch asset generator for CodeChronoBullet — Cover Props
 * Uses REAL Agnes API (no mock) to generate assets.
 * Output lands directly into D:/Projects/CodeChronoBullet/assets/cover/
 */
import fs from 'fs';
import path from 'path';
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

async function main() {
  console.log(`\n=== CodeChronoBullet Cover Prop Asset Batch (REAL API) ===\n`);
  console.log(`Target dir: ${TARGET_COVER}`);
  console.log(`Output root: ${OUTPUT_ROOT}\n`);

  const results = [];
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const p of props) {
    console.log(`\n● ${p.prop_id} — ${p.prompt.slice(0, 60)}...`);

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
      console.log(`  ✗ QC: ${qcStatus}  candidate: ${candDir}`);
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
