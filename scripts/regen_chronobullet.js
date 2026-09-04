#!/usr/bin/env node
/**
 * CodeChronoBullet 资产重生成脚本
 *
 * 使用 sprite-gen 的 Agnes API + 切图后处理，重新生成不合格的关键资产。
 *
 * 优先级：
 * 1. 玩家角色 (player_base_female.png)
 * 2. 武器层 (assault_rifle, pistol_9mm, pump_shotgun)
 * 3. 掩体 v2 系列 (burnt_car_wreck, metal_shelving, sandbag_wall, wooden_barricade)
 * 4. 场景背景 (main_bg, result_bg)
 */

import { generateImage } from '../lib/image_gen.js';
import { auditAssets } from '../lib/audit.js';
import { runPythonScript } from '../lib/utils.js';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ASSETS_ROOT = path.join(PROJECT_ROOT, '..', 'CodeChronoBullet', 'assets');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', 'regen_chronobullet');

// ─── 资产定义 ───────────────────────────────────────────────────────────────────

const ASSETS = [
  // 玩家角色
  {
    id: 'player_base_female',
    path: 'sprites/player/player_base_female.png',
    width: 512,
    height: 768,
    prompt: `Create ONE complete 2D game character sprite for a war-survival game.

SUBJECT
One adult female survivor, shown from head to boots. Her entire head, hair, face, neck, torso, both arms, both hands, both legs and both boots must all be visible and anatomically connected. She faces exactly RIGHT in a strict flat side view.

POSE
Neutral combat-ready idle pose. Both elbows are bent. Both EMPTY hands are raised naturally in front of the chest as if holding an invisible rifle. The hands must not hang beside the thighs. Do not draw any weapon.

CLOTHING
Fitted charcoal long-sleeve undershirt, worn olive work trousers and old combat boots only. No helmet, armor, vest, chest rig, backpack, bag, holster or large equipment.

COMPOSITION
Canvas size: 512×768 pixels. Show the complete full body with generous empty space around it. The top of the hair must stay below y=35. The bottom of both boots must rest at y=730. Center the character around x=256. Place the dominant empty hand around x=310, y=335.

BACKGROUND AND FILE
The background must be genuinely transparent: all pixels outside the character must have alpha=0.
Do not draw a checkerboard pattern. Do not draw white, black or colored background pixels.
Do not draw a floor, shadow, glow, border, text, UI, watermark or logo.

STYLE
War-survival graphic-novel illustration: realistic anatomy, charcoal contours, restrained dirty watercolor, low-saturation cold gray, faded olive and rust-brown accents, clear silhouette, upper-left lighting.

FINAL CHECK:
- exactly one complete female person is visible
- head, torso, both arms, both hands, both legs and both boots are present
- no weapon or equipment
- true transparent background, not a painted checkerboard
- full character fits inside the canvas with space around her`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, watermark, text, logo, border',
  },

  // 武器层
  {
    id: 'assault_rifle',
    path: 'weapons/assault_rifle.png',
    width: 512,
    height: 768,
    prompt: `Create only the assault rifle overlay for a modular character system.

Using the supplied canonical player_base_female.png as a locked registration template (not included in output), create only the assault rifle overlay.

Place the pistol-grip contact point exactly at (310,335). Point the barrel exactly right. Match believable scale to the character: stock seated at the shoulder, trigger grip inside the dominant hand, fore-end passing through the support-hand position.

Draw one worn, unbranded intermediate-caliber assault rifle. Strict flat side view, upper-left lighting.

Do not draw hands, arms, character pixels, sling, muzzle flash, casing, smoke, floor, or weapon showcase background. Do not center or enlarge the rifle as a product image.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

Output: 512×768 RGBA PNG with true transparent background. Every pixel outside the rifle must be alpha=0.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, hands, arms, watermark, text, logo',
  },

  {
    id: 'pistol_9mm',
    path: 'weapons/pistol_9mm.png',
    width: 512,
    height: 768,
    prompt: `Create only the 9mm pistol overlay for a modular character system.

Using the supplied canonical player_base_female.png as a locked registration template (not included in output), create only the 9mm pistol overlay.

Place the pistol-grip contact point exactly at (310,335). Barrel and muzzle point RIGHT. Believable character-relative size; not enlarged as a product image.

Draw one compact worn 9mm pistol, unbranded, strict flat side view, upper-left lighting.

Do not draw hands, arms, character pixels, sling, smoke, casing, effects, floor or shadow.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

Output: 512×768 RGBA PNG with true transparent background. Every pixel outside the pistol must be alpha=0.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, hands, arms, watermark, text, logo',
  },

  {
    id: 'pump_shotgun',
    path: 'weapons/shotgun_pump.png',
    width: 512,
    height: 768,
    prompt: `Create only the pump-action shotgun overlay for a modular character system.

Stock on the LEFT, receiver in the middle, barrel and muzzle pointing RIGHT. Main-hand grip center exactly at (310,335); fore-end aligned with the character's support hand.

Draw one worn pump-action shotgun, strict flat side view, upper-left lighting. Believable character-relative size.

Do not draw hands, arms, character pixels, sling, smoke, casing, effects, floor or shadow.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

Output: 512×768 RGBA PNG with true transparent background. Every pixel outside the shotgun must be alpha=0.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, hands, arms, watermark, text, logo',
  },
];

// ─── 工具函数 ───────────────────────────────────────────────────────────────────

async function regenerateAsset(asset) {
  const fullPath = path.join(ASSETS_ROOT, asset.path);
  mkdirSync(path.dirname(fullPath), { recursive: true });

  console.log(`\n[${asset.id}] Generating ${asset.path} (${asset.width}x${asset.height})...`);

  // 1. 调用 Agnes API 生成图像
  const genResult = await generateImage({
    provider: 'agnes',
    prompt: asset.prompt,
    negative_prompt: asset.negativePrompt,
    width: asset.width,
    height: asset.height,
    num_images: 1,
    model: 'agnes-image-2.5-flash',
  });

  if (!genResult.success || !genResult.data?.images?.length) {
    console.error(`  ✗ Generation failed: ${genResult.error?.message || 'No images returned'}`);
    return null;
  }

  const img = genResult.data.images[0];
  console.log(`  ✓ Generated (${img.metadata?.width || asset.width}x${img.metadata?.height || asset.height})`);

  // 2. 保存原始生成图
  const rawPath = path.join(OUTPUT_DIR, `${asset.id}_raw.png`);
  const rawBuf = Buffer.from(img.data, 'base64');
  writeFileSync(rawPath, rawBuf);
  console.log(`  ✓ Saved raw: ${rawPath} (${rawBuf.length} bytes)`);

  // 3. 运行切图后处理
  const cutoutResult = await runPythonScript({
    command: 'cutout',
    image_path: rawPath,
    output_path: fullPath,
    dist_threshold: 60,
    corner_region: 8,
    target_width: asset.width,
    target_height: asset.height,
  });

  if (!cutoutResult.success) {
    console.error(`  ✗ Cutout failed: ${cutoutResult.error?.message || 'Unknown error'}`);
    return null;
  }

  const finalBuf = readFileSync(fullPath);
  console.log(`  ✓ Cutout complete: ${fullPath} (${finalBuf.length} bytes)`);

  // 4. QC 验证
  const qcResult = await auditAssets({
    input_path: path.dirname(fullPath),
    strict: true,
    asset_type: 'cover_prop',
  });

  const assetAudit = qcResult.data?.assets?.find(a => a.asset_path === fullPath);
  if (assetAudit?.status === 'APPROVED') {
    console.log(`  ✓ QC PASSED`);
    return { id: asset.id, status: 'APPROVED', path: fullPath };
  } else {
    console.log(`  ✗ QC FAILED: ${assetAudit?.hard_failures?.join(', ') || 'Unknown'}`);
    return { id: asset.id, status: 'REJECTED', path: fullPath, failures: assetAudit?.hard_failures };
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Target assets root: ${ASSETS_ROOT}`);

  const results = [];
  for (const asset of ASSETS) {
    const result = await regenerateAsset(asset);
    results.push(result);
  }

  // 汇总
  const approved = results.filter(r => r?.status === 'APPROVED').length;
  const rejected = results.filter(r => r?.status === 'REJECTED').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${approved} APPROVED, ${rejected} REJECTED out of ${ASSETS.length}`);
  console.log(`${'='.repeat(60)}`);

  // 写报告
  const report = {
    timestamp: new Date().toISOString(),
    total: ASSETS.length,
    approved,
    rejected,
    results,
  };
  writeFileSync(
    path.join(OUTPUT_DIR, 'regen_report.json'),
    JSON.stringify(report, null, 2)
  );

  process.exit(rejected > 0 ? 1 : 0);
}

// 需要导入 readFileSync
import { readFileSync } from 'fs';

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
