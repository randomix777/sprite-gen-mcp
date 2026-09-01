/**
 * Retry with optimized prompts for better QC compliance
 */
import { generateCoverPropPhase1 } from './lib/cover_prop_phased.js';
import fs from 'fs';

const props = [
  {
    prop_id: 'sandbag_wall_v2',
    prompt: `War-survival graphic-novel style sandbag wall. Strict right-facing side view, orthographic projection. Weathered burlap sacks filled with sand, stacked in staggered courses, earth tones tan ochre brown. The BOTTOM EDGE of the sandbag wall must touch exactly y=115 pixel line (90% of 128px canvas height). Solid magenta background ONLY - absolutely no checkerboard, no grid, no pattern, no gradient. Keep object centered horizontally. No character, no floor, no shadow, no text. 128x128 canvas.`,
    material_type: 'fabric',
    cover_height: 'low',
  },
  {
    prop_id: 'burnt_car_wreck',
    prompt: `War-survival graphic-novel style burnt car wreck. Strict right-facing side view, orthographic projection. Rusted sedan frame, charred body panels, missing wheels, exposed frame. Rust orange brown gray tones. The BOTTOM EDGE of the car wreck must touch exactly y=115 pixel line (90% of 128px canvas height). Solid magenta background ONLY - absolutely no checkerboard, no grid, no pattern, no gradient. Keep object centered horizontally. No character, no floor, no shadow, no text. 128x128 canvas.`,
    material_type: 'metal',
    cover_height: 'medium',
  },
  {
    prop_id: 'metal_shelving_v2',
    prompt: `War-survival graphic-novel style metal shelving unit. Strict right-facing side view, orthographic projection. Steel-gray industrial shelf, three tiers, empty metal crates on shelves, scuffed paint, minor dents. The BOTTOM EDGE of the shelving unit must touch exactly y=115 pixel line (90% of 128px canvas height). Solid magenta background ONLY - absolutely no checkerboard, no grid, no pattern, no gradient. Keep object centered horizontally. No character, no floor, no shadow, no text. 128x128 canvas.`,
    material_type: 'metal',
    cover_height: 'high',
  },
  {
    prop_id: 'wooden_barricade',
    prompt: `War-survival graphic-novel style wooden barricade. Strict right-facing side view, orthographic projection. Cross-planked barrier, weathered olive-drab and rust-brown wood grain, visible nail heads, rough-hewn planks nailed together. The BOTTOM EDGE of the barricade must touch exactly y=115 pixel line (90% of 128px canvas height). Solid magenta background ONLY - absolutely no checkerboard, no grid, no pattern, no gradient. Keep object centered horizontally. No character, no floor, no shadow, no text. 128x128 canvas.`,
    material_type: 'wood',
    cover_height: 'low',
  },
];

async function main() {
  console.log(`\n=== Phase 1: Generate with Optimized Prompts ===\n`);

  const results = [];
  
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    console.log(`\n● [${i + 1}/${props.length}] ${p.prop_id}...`);
    
    const res = await generateCoverPropPhase1(p);
    
    const status = res.data?.status || res.error?.code || 'ERROR';
    const candidatesDir = res.data?.candidates_dir || '';
    
    console.log(`  Status: ${status}`);
    console.log(`  Dir: ${candidatesDir}`);
    
    results.push({ prop_id: p.prop_id, status, candidates_dir: candidatesDir });
    
    // Small delay between requests
    if (i < props.length - 1) {
      console.log(`  Waiting 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n=== Summary ===`);
  for (const r of results) {
    console.log(`${r.prop_id}: ${r.status}`);
  }

  // Save report
  fs.writeFileSync('output/phase1_retry_report.json', JSON.stringify(results, null, 2));
  console.log(`\nReport saved to: output/phase1_retry_report.json`);
}

main().catch(console.error);
