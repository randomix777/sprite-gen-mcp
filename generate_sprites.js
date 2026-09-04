/**
 * Generate game sprites directly via AGNES API.
 * Bypasses sprite-gen's broken Python post-processing.
 */
import { providerFetch } from './lib/provider_http.js';
import fs from 'fs';

const KEY = process.env.AGNES_API_KEY;
if (!KEY) throw new Error('Set AGNES_API_KEY before running this script');
const BASE_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
const MODEL = 'agnes-image-2.1-flash';
const PROJECT = 'D:/Projects/CodeChronoBullet/assets';

async function generate(name, prompt, width, height) {
  const outPath = `${PROJECT}/${name}.png`;
  console.log(`Generating ${name} (${width}x${height})...`);
  
  const resp = await providerFetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: { model: MODEL, prompt, size: `${width}x${height}`, n: 1 },
    provider: 'agnes', stage: 'provider', timeout: 120000
  });

  if (!resp.success) {
    console.error(`  FAILED: ${JSON.stringify(resp.error)}`);
    return false;
  }

  const img = resp.data.data[0];
  let imageUrl = img.url || img.b64_json;
  if (!imageUrl) {
    console.error(`  FAILED: no image data in response`);
    return false;
  }

  let buffer;
  if (imageUrl.startsWith('data:')) {
    // Base64 data URL
    const base64 = imageUrl.split(',')[1];
    buffer = Buffer.from(base64, 'base64');
  } else if (imageUrl.startsWith('http')) {
    // Download from URL
    const imgResp = await providerFetch(imageUrl, {
      method: 'GET',
      provider: 'agnes-download', stage: 'download', timeout: 30000
    });
    if (!imgResp.success) {
      console.error(`  FAILED to download: ${JSON.stringify(imgResp.error)}`);
      return false;
    }
    buffer = Buffer.from(imgResp.data, 'base64');
  } else {
    // Raw base64
    buffer = Buffer.from(imageUrl, 'base64');
  }

  fs.mkdirSync(outPath.substring(0, outPath.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  console.log(`  OK: ${outPath} (${buffer.length} bytes)`);
  return true;
}

// ─── Player sprites (512x768) ───────────────────────────────────────────────
await generate('sprites/player/player_idle',
  'a tactical female soldier in military gear, side profile, idle standing pose, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/player/player_run',
  'a tactical female soldier in military gear, running pose, side profile, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/player/player_jump',
  'a tactical female soldier in military gear, jumping pose, side profile, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/player/player_shoot',
  'a tactical female soldier in military gear, shooting pose holding a pistol, side profile, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/player/player_hurt',
  'a tactical female soldier in military gear, recoiling from impact, hurt pose, side profile, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/player/player_death',
  'a tactical female soldier in military gear, fallen on ground, side profile, realistic military art style, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

// ─── Enemy sprites (512x768) ────────────────────────────────────────────────
await generate('sprites/enemies/enemy_raider',
  'a hostile militia fighter, side profile, aggressive stance, worn military gear, scarred face, dark muted colors, realistic military art style,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

await generate('sprites/enemies/enemy_warlord',
  'a menacing warlord commander, side profile, imposing stance, heavy tactical gear, scarred face, dark muted colors, realistic military art style,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality, This War of Mine aesthetic',
  512, 768);

// ─── Weapon sprites (512x512) ───────────────────────────────────────────────
await generate('weapons/pistol_9mm',
  'a 9mm semi-automatic pistol, side profile view, detailed mechanical parts, metallic sheen, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/assault_rifle',
  'an AK-47 assault rifle, side profile view, detailed mechanical parts, metallic and wood textures, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/bolt_action_rifle',
  'a bolt-action sniper rifle, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/pump_shotgun',
  'a pump-action shotgun, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/desert_eagle',
  'a Desert Eagle .50 AE pistol, side profile view, detailed mechanical parts, metallic sheen, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/m1911_pistol',
  'a M1911 .45 ACP pistol, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/m1_garand',
  'an M1 Garand rifle, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/mp5_smg',
  'an MP5 submachine gun, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/sks_rifle',
  'an SKS semi-automatic rifle, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

await generate('weapons/bolt_action_rifle',
  'a Kar98k bolt-action rifle, side profile view, detailed mechanical parts, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), realistic military art style, game sprite quality',
  512, 512);

// ─── Equipment sprites (512x768) ────────────────────────────────────────────
await generate('equipment/heads/steel_helmet',
  'a steel combat helmet, side view, realistic military gear, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('equipment/chests/light_ballistic_vest',
  'a light ballistic vest, front view, realistic military gear, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('equipment/backpacks/medium_assault_pack',
  'a medium assault backpack, side view, realistic military gear, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

// ─── Door sprites (interactive props) ───────────────────────────────────────
await generate('cover/metal_door_closed',
  'a closed metal door, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/metal_door_open',
  'an open metal door, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/wooden_door_closed',
  'a closed wooden door, side view, residential setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/wooden_door_open',
  'an open wooden door, side view, residential setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/wooden_door_breached',
  'a breached wooden door with broken panels, side view, residential setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

// ─── Container sprites ──────────────────────────────────────────────────────
await generate('containers/wooden_crate_closed',
  'a closed wooden crate, side view, realistic military supply crate, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('containers/wooden_crate_empty',
  'an empty open wooden crate, side view, realistic military supply crate, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('containers/refrigerator_closed',
  'a closed refrigerator, side view, residential kitchen setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('containers/refrigerator_open',
  'an open refrigerator, side view, residential kitchen setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('containers/refrigerator_empty',
  'an empty open refrigerator, side view, residential kitchen setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

// ─── Furniture/prop sprites ─────────────────────────────────────────────────
await generate('furniture/wooden_cabinet',
  'a wooden cabinet, side view, residential furniture, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('furniture/metal_shelf_empty',
  'an empty metal shelf, side view, industrial furniture, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('furniture/bed_frame',
  'a bed frame, side view, residential furniture, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

// ─── Cover sprites ──────────────────────────────────────────────────────────
await generate('cover/barrier_concrete',
  'a concrete barrier, side view, military fortification, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('cover/sandbag_wall',
  'a sandbag wall section, side view, military fortification, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('cover/burnt_car',
  'a burnt abandoned car, side view, war-torn urban setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('cover/broken_window',
  'a broken window frame, side view, ruined building, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('cover/chain_lock_door',
  'a chained locked door, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/concrete_wall_broken',
  'a broken concrete wall section, side view, war-torn building, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

await generate('cover/ladder_section',
  'a ladder section, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/metal_shelf',
  'a metal shelving unit, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/metal_shelving_full',
  'a fully stocked metal shelving unit, side view, industrial setting, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 768);

await generate('cover/wooden_crate',
  'a wooden crate, side view, military supply, dark muted colors,
solid magenta background (uniform flat single color, no pattern, chroma key), game sprite quality',
  512, 512);

console.log('\nDone!');
