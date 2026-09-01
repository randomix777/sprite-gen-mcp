/**
 * Retry batch for failed assets
 */
import fs from 'fs';
import path from 'path';
import { generateCoverPropService } from './lib/services.js';

const TARGET_COVER = 'D:/Projects/CodeChronoBullet/assets/cover';
const OUTPUT_ROOT = path.join(process.cwd(), 'output', 'chronobullet_assets');

const failedProps = [
  {
    prop_id: 'barrier_concrete_v2',
    prompt: 'War-survival graphic-novel style. A concrete roadblock barrier viewed in strict right-facing orthographic side view. Visible exposed rebar jutting from broken edges. Worn gray concrete with cracks, stains, and rusted steel reinforcement. Low cover suitable for crouching behind. No character, no floor, no shadow, no text.',
    material_type: 'masonry',
    cover: { height: 'low' },
  },
  {
    prop_id: 'sandbag_wall_v2',
    prompt: 'War-survival graphic-novel style. A stacked sandbag wall in strict right-facing side view. Weathered burlap sacks filled with sand, tied at intervals, arranged in staggered courses. Earth tones — tan, ochre, dusty brown. Low cover. No character, no floor, no shadow, no text.',
    material_type: 'fabric',
    cover: { height: 'low' },
  },
  {
    prop_id: 'metal_shelving_v2',
    prompt: 'War-survival graphic-novel style. An upright metal shelving unit viewed in strict right-facing side view. Steel-gray frame with three shelves holding scattered empty crates and cans. Scuffed paint, minor dents. Medium-tall cover, partially obscures standing figure. No character, no floor, no shadow, no text.',
    material_type: 'metal',
    cover: { height: 'high' },
  },
  {
    prop_id: 'wooden_barricade',
    prompt: 'War-survival graphic-novel style. A wooden barricade in strict right-facing side view. Cross-planked barrier nailed together with visible nail heads, weathered olive-drab and rust-brown wood grain. Low-to-medium cover. No character, no floor, no shadow, no text.',
    material_type: 'wood',
    cover: { height: 'low' },
  },
  {
    prop_id: 'concrete_wall_broken_v2',
    prompt: 'War-survival graphic-novel style. A broken concrete wall section in strict right-facing side view. Jagged breach hole in the center, exposed rebar, crumbling edge. Gray concrete with water stains and surface spalling. High cover for standing position. No character, no floor, no shadow, no text.',
    material_type: 'masonry',
    cover: { height: 'high' },
  },
];

async function retryWithDelay(prop, delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs)).then(() => generateCoverPropService({
    prompt: prop.prompt,
    prop_id: prop.prop_id,
    material_type: prop.material_type,
    width: 128, height: 128,
    ground_anchor: [64, 115],
    cover: prop.cover,
    provider: 'agnes',
    output_dir: OUTPUT_ROOT,
  }));
}

async function main() {
  console.log(`\n=== Retrying ${failedProps.length} failed assets ===\n`);

  const results = [];
  let approvedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < failedProps.length; i++) {
    const p = failedProps[i];
    const delay = i * 3000; // 3s between requests
    
    console.log(`\n● [${i+1}/${failedProps.length}] ${p.prop_id}...`);
    const res = await retryWithDelay(p, delay);
    
    const qcStatus = res.success ? (res.data?.qc_status || 'UNKNOWN') : (res.error?.code || 'ERROR');
    const ok = qcStatus === 'APPROVED';
    
    if (ok && res.data?.state_results?.intact?.path) {
      const intactPath = res.data.state_results.intact.path;
      const rubblePath = res.data.state_results.rubble?.path || '';
      
      if (fs.existsSync(intactPath)) {
        fs.copyFileSync(intactPath, path.join(TARGET_COVER, `${p.prop_id}_intact.png`));
        console.log(`  → COPIED intact`);
      }
      if (rubblePath && fs.existsSync(rubblePath)) {
        fs.copyFileSync(rubblePath, path.join(TARGET_COVER, `${p.prop_id}_rubble.png`));
        console.log(`  → COPIED rubble`);
      }
      approvedCount++;
    } else {
      failedCount++;
      console.log(`  ✗ ${qcStatus}`);
      if (res.error) {
        console.log(`    Error: ${res.error.message?.slice(0, 100)}`);
      }
    }
    
    results.push({ prop_id: p.prop_id, qc_status: qcStatus, ok });
    
    // Small delay between retries
    if (i < failedProps.length - 1) {
      console.log(`  Waiting 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n=== Retry Summary ===`);
  console.log(`Approved: ${approvedCount}/${failedProps.length}`);
  console.log(`Failed: ${failedCount}/${failedProps.length}`);
}

main().catch(console.error);
