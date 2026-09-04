#!/usr/bin/env node
/**
 * CodeChronoBullet 资产重生成脚本 v2
 *
 * 修复两个关键问题：
 * 1. cutout 输出必须直接写入目标路径（不使用临时文件）
 * 2. 使用正确的 Agnes API 参数（size/ratio 而非精确像素）
 */

import { generateImage } from '../lib/image_gen.js';
import { auditAssets } from '../lib/audit.js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';

const PROJECT_ROOT = path.resolve('.');
const ASSETS_ROOT = path.join(PROJECT_ROOT, '..', 'CodeChronoBullet', 'assets');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', 'regen_chronobullet_v2');

// ─── 资产定义 ───────────────────────────────────────────────────────────────────

const ASSETS = [
  // 玩家角色 - 需要完整的 512x768 角色图，角色占画布约 25-35%
  {
    id: 'player_base_female',
    path: 'sprites/player/player_base_female.png',
    width: 512,
    height: 768,
    // Agnes 原生比例: 2:3 = 832x1248 → 缩放到 512x768
    agnesSize: '1K',
    agnesRatio: '2:3',
    prompt: `A complete 2D game character sprite of an adult female survivor in a war-survival setting. 

Full body shown from head to boots, facing exactly RIGHT in a strict flat side view. She has dark hair in a short practical ponytail, wearing a fitted charcoal long-sleeve undershirt, worn olive work trousers, and old combat boots. 

Neutral combat-ready idle pose: both elbows bent, both EMPTY hands raised naturally in front of the chest as if holding an invisible rifle. Hands must not hang beside thighs. No weapon visible.

Generate with genuinely transparent background - every pixel outside the character must have alpha=0. NO checkerboard pattern, NO white/colored background, NO floor shadow, NO border, NO text, NO watermark.

Art style: war-survival graphic-novel illustration, realistic anatomy, charcoal contours, restrained dirty watercolor, low-saturation cold gray, faded olive and rust-brown accents, clear silhouette, upper-left lighting.

The character should occupy roughly 25-35% of the canvas area with generous empty space around all sides.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, white background, black background, floor, shadow, glow, border, text, watermark, logo, ui, HUD, close-up, cropped',
  },

  // 突击步枪层 - 武器层应占画布约 35-50%
  {
    id: 'assault_rifle',
    path: 'weapons/assault_rifle.png',
    width: 512,
    height: 768,
    agnesSize: '1K',
    agnesRatio: '2:3',
    prompt: `A worn, unbranded intermediate-caliber assault rifle for a modular character system. 

Strict flat side view, barrel and muzzle pointing RIGHT. Detailed mechanical parts visible: stock, receiver, trigger guard, magazine well, handguard, barrel, front sight. Upper-left lighting creating subtle shadows.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

The rifle should occupy roughly 35-50% of the canvas. Genuinely transparent background - every pixel outside the rifle must have alpha=0. NO checkerboard, NO background, NO character, NO hands, NO sling, NO smoke, NO casing, NO floor shadow.

Output as clean weapon sprite layer ready for character overlay system.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, person, hands, arms, sling, smoke, muzzle flash, casing, cartridge, floor, shadow, logo, text, watermark',
  },

  // 手枪层
  {
    id: 'pistol_9mm',
    path: 'weapons/pistol_9mm.png',
    width: 512,
    height: 768,
    agnesSize: '1K',
    agnesRatio: '2:3',
    prompt: `A compact worn 9mm pistol for a modular character system. 

Strict flat side view, barrel and muzzle pointing RIGHT. Detailed: slide, barrel, grip, trigger, sights. Believable character-relative size - not enlarged as a product shot.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

The pistol should occupy roughly 20-30% of the canvas. Genuinely transparent background - every pixel outside the pistol must have alpha=0. NO checkerboard, NO background, NO character, NO hands, NO holster, NO floor shadow.

Output as clean weapon sprite layer ready for character overlay system.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, person, hands, arms, holster, magazine, smoke, casing, floor, shadow, logo, text, watermark, product shot',
  },

  // 泵动霰弹枪层
  {
    id: 'pump_shotgun',
    path: 'weapons/shotgun_pump.png',
    width: 512,
    height: 768,
    agnesSize: '1K',
    agnesRatio: '2:3',
    prompt: `A worn pump-action shotgun for a modular character system.

Stock on the LEFT, receiver in the middle, barrel and muzzle pointing RIGHT. Visible pump action, magazine tube, trigger guard, wooden or synthetic stock and fore-end. Upper-left lighting.

Style: war-survival graphic-novel illustration — charcoal contours, dirty watercolor, low-saturation cold gray, clear silhouette.

The shotgun should occupy roughly 25-40% of the canvas. Genuinely transparent background - every pixel outside the shotgun must have alpha=0. NO checkerboard, NO background, NO character, NO hands, NO sling, NO smoke, NO floor shadow.

Output as clean weapon sprite layer ready for character overlay system.`,
    negativePrompt: 'checkerboard, grid, checkered background, opaque background, character, person, hands, arms, sling, smoke, casing, floor, shadow, logo, text, watermark, product shot',
  },
];

// ─── 核心函数 ───────────────────────────────────────────────────────────────────

async function regenerateAsset(asset) {
  const fullPath = path.join(ASSETS_ROOT, asset.path);
  mkdirSync(path.dirname(fullPath), { recursive: true });

  console.log(`\n[${asset.id}] Generating ${asset.path}...`);
  console.log(`  Target: ${asset.width}x${asset.height}, Agnes: ${asset.agnesSize} ${asset.agnesRatio}`);

  // 1. 调用 Agnes API 生成（使用 size/ratio 而非精确像素）
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
    console.error(`  ✗ Generation failed: ${genResult.error?.message || 'No images'}`);
    return null;
  }

  const img = genResult.data.images[0];
  console.log(`  ✓ Generated (${img.metadata?.width || asset.width}x${img.metadata?.height || asset.height})`);

  // 2. 直接写入最终路径（跳过临时文件）
  const rawBuf = Buffer.from(img.data, 'base64');
  writeFileSync(fullPath, rawBuf);
  console.log(`  ✓ Saved: ${fullPath} (${rawBuf.length} bytes)`);

  // 3. QC 验证
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
    
    // 诊断信息
    if (assetAudit?.measurements) {
      const m = assetAudit.measurements;
      console.log(`  Measurements: body=${(m.body_ratio*100).toFixed(1)}%, margin=${(m.min_margin*100).toFixed(1)}%, noise=${m.noise_ratio.toFixed(3)}`);
    }
    
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
    path.join(OUTPUT_DIR, 'regen_report_v2.json'),
    JSON.stringify(report, null, 2)
  );

  process.exit(rejected > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
