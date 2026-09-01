/**
 * Retry rejected assets with improved prompts
 */
import fs from 'fs';
import path from 'path';
import { generateCoverPropService } from './lib/services.js';

const TARGET_COVER = 'D:/Projects/CodeChronoBullet/assets/cover';
const OUTPUT_ROOT = path.join(process.cwd(), 'output', 'chronobullet_assets');

// Improved prompts with stronger emphasis on solid background and ground anchor
const retryProps = [
  {
    prop_id: 'barrier_concrete_v2',
    prompt: `War-survival graphic-novel style concrete roadblock. Side view, strict orthographic projection. Gray concrete barrier with exposed rebar, cracks, rust stains. Flat solid magenta background ONLY - no patterns, no gradients, no checkerboard. Object bottom edge MUST touch y=115 pixel line (90% of canvas height). 128x128 canvas.`,
    material_type: 'masonry',
    cover: { height: 'low' },
    color_note: 'gray concrete',
  },
  {
    prop_id: 'concrete_wall_broken_v2',
    prompt: `War-survival graphic-novel style broken concrete wall section. Side view, strict orthographic projection. Jagged hole in center, exposed rebar, crumbling edges. Flat solid magenta background ONLY - no patterns, no gradients, no checkerboard. Object bottom edge MUST touch y=115 pixel line (90% of canvas height). 128x128 canvas.`,
    material_type: 'masonry',
    cover: { height: 'high' },
    color_note: 'light gray concrete',
  },
];

async function main() {
  console.log(`\n=== Retrying Rejected Assets (Improved Prompts) ===\n`);
  console.log(`Target: ${TARGET_COVER}\n`);

  let approvedCount = 0;
  let failedCount = 0;

  for (const prop of retryProps) {
    console.log(`● ${prop.prop_id} (${prop.color_note})...`);
    
    const res = await generateCoverPropService({
      prompt: prop.prompt,
      prop_id: prop.prop_id,
      material_type: prop.material_type,
      width: 128,
      height: 128,
      ground_anchor: [64, 115],
      cover: prop.cover,
      provider: 'agnes',
      output_dir: OUTPUT_ROOT,
    });

    const qcStatus = res.success ? (res.data?.qc_status || 'UNKNOWN') : (res.error?.code || 'ERROR');
    const ok = qcStatus === 'APPROVED';
    
    if (ok && res.data?.state_results?.intact?.path) {
      const intactPath = res.data.state_results.intact.path;
      const rubblePath = res.data.state_results.rubble?.path || '';
      
      if (fs.existsSync(intactPath)) {
        const dst = path.join(TARGET_COVER, `${prop.prop_id}_intact.png`);
        fs.copyFileSync(intactPath, dst);
        console.log(`  → COPIED intact: ${path.basename(dst)}`);
      }
      if (rubblePath && fs.existsSync(rubblePath)) {
        const dst = path.join(TARGET_COVER, `${prop.prop_id}_rubble.png`);
        fs.copyFileSync(rubblePath, dst);
        console.log(`  → COPIED rubble: ${path.basename(dst)}`);
      }
      approvedCount++;
    } else {
      failedCount++;
      console.log(`  ✗ ${qcStatus}`);
      if (res.error?.message) {
        console.log(`    ${res.error.message.slice(0, 80)}`);
      }
    }
    
    // Delay between requests
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Approved: ${approvedCount}/${retryProps.length}`);
  console.log(`Failed: ${failedCount}/${retryProps.length}`);
}

main().catch(console.error);
