#!/usr/bin/env node
/**
 * gen_fixtures.js — Generate test fixture assets for dsh-sprite-gen
 *
 * Creates:
 *   - Godot project skeleton (project.godot, scenes, sprites)
 *   - 128×64 hero sprite (2-frame checkerboard)
 *   - 256×256 palette / QC checkerboard (4 colors)
 *   - 256×64 four-frame animation sprite sheet
 *   - Tiny test video via ffmpeg (skip if unavailable)
 *
 * Usage:  node test/fixtures/gen_fixtures.js
 * Idempotent — skips files that already exist.
 */

import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

// ---------------------------------------------------------------------------
// Lazy-load sharp (project dependency)
// ---------------------------------------------------------------------------
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('[gen_fixtures] sharp not installed — run npm install first');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function skipIfExists(filePath, label) {
  if (existsSync(filePath)) {
    console.log(`  skip ${label} (exists)`);
    return true;
  }
  return false;
}

/**
 * Build a checkerboard PNG buffer.
 * @param {number} w  width in pixels
 * @param {number} h  height in pixels
 * @param {number} cellSize  checker cell size in pixels
 * @param {string[]} colors  array of hex colors cycled through
 * @returns {Buffer}
 */
async function checkerboard(w, h, cellSize, colors) {
  const channels = 4; // RGBA
  const buf = Buffer.alloc(w * h * channels);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const idx = (cy * Math.ceil(w / cellSize) + cx) % colors.length;
      const hex = colors[idx];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const off = (y * w + x) * channels;
      buf[off] = r;
      buf[off + 1] = g;
      buf[off + 2] = b;
      buf[off + 3] = 255;
    }
  }

  return sharp(buf, { raw: { width: w, height: h, channels } })
    .png()
    .toBuffer();
}

/**
 * Build a 4-frame horizontal sprite sheet PNG.
 * Each frame is `cellW × cellH`; total image is `(cellW * 4) × cellH`.
 * Frames cycle through the given colors.
 */
async function spriteSheet(cellW, cellH, colors) {
  const w = cellW * 4;
  const h = cellH;
  const channels = 4;
  const buf = Buffer.alloc(w * h * channels);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const frameIdx = Math.floor(x / cellW);
      const color = colors[frameIdx % colors.length];
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const off = (y * w + x) * channels;
      buf[off] = r;
      buf[off + 1] = g;
      buf[off + 2] = b;
      buf[off + 3] = 255;
    }
  }

  return sharp(buf, { raw: { width: w, height: h, channels } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// 1. Godot project structure
// ---------------------------------------------------------------------------
async function createGodotProject() {
  console.log('[gen_fixtures] Godot project…');

  // project.godot
  const godotDir = path.join(FIXTURES, 'godot_project');
  const projectFile = path.join(godotDir, 'project.godot');
  if (!skipIfExists(projectFile, 'project.godot')) {
    ensureDir(godotDir);
    // The actual file was created externally; just ensure dirs exist.
    ensureDir(path.join(godotDir, 'scenes'));
    ensureDir(path.join(godotDir, 'sprites'));
  }

  // scenes/player.tscn is created externally as well — just ensure dir
  ensureDir(path.join(godotDir, 'scenes'));
  ensureDir(path.join(godotDir, 'sprites'));
}

// ---------------------------------------------------------------------------
// 2. Hero sprite — 128×64 (two 64×64 frames, red/blue checker)
// ---------------------------------------------------------------------------
async function createHeroSprite() {
  console.log('[gen_fixtures] hero sprite (128×64)…');
  const out = path.join(FIXTURES, 'godot_project', 'sprites', 'hero.png');
  if (skipIfExists(out, 'hero.png')) return;

  const buf = await checkerboard(128, 64, 16, ['#e74c3c', '#3498db']); // red, blue
  const { writeFileSync } = await import('fs');
  writeFileSync(out, buf);
}

// ---------------------------------------------------------------------------
// 3. QC / palette checkerboard — 256×256, 4 colors
// ---------------------------------------------------------------------------
async function createPaletteChecker() {
  console.log('[gen_fixtures] palette checker (256×256)…');
  const out = path.join(FIXTURES, 'palette_checker.png');
  if (skipIfExists(out, 'palette_checker.png')) return;

  const buf = await checkerboard(256, 256, 32, [
    '#e74c3c', // red
    '#3498db', // blue
    '#2ecc71', // green
    '#f1c40f', // yellow
  ]);
  const { writeFileSync } = await import('fs');
  writeFileSync(out, buf);
}

// ---------------------------------------------------------------------------
// 4. Animation sprite sheet — 256×64, 4 frames (64×64 each)
// ---------------------------------------------------------------------------
async function createAnimationSheet() {
  console.log('[gen_fixtures] animation sheet (256×64)…');
  const out = path.join(FIXTURES, 'anim_sheet.png');
  if (skipIfExists(out, 'anim_sheet.png')) return;

  const buf = await spriteSheet(64, 64, [
    '#e74c3c', // frame 0 — red
    '#3498db', // frame 1 — blue
    '#2ecc71', // frame 2 — green
    '#f1c40f', // frame 3 — yellow
  ]);
  const { writeFileSync } = await import('fs');
  writeFileSync(out, buf);
}

// ---------------------------------------------------------------------------
// 5. Tiny test video via ffmpeg (skip if not available)
// ---------------------------------------------------------------------------
async function createTestVideo() {
  console.log('[gen_fixtures] test video…');
  const out = path.join(FIXTURES, 'test_video.mp4');
  if (skipIfExists(out, 'test_video.mp4')) return;

  const { execSync } = await import('child_process');
  try {
    // Generate a 2-second 32×32 solid-red video using ffmpeg.
    // -y overwrites, -t sets duration, -vf scales to 32×32.
    execSync(
      'ffmpeg -y -f lavfi -i color=c=red:s=32x32:d=2 -vf fps=4 -c:v libx264 -pix_fmt yuv420p "' +
        out +
        '"',
      { stdio: 'ignore', timeout: 10_000 }
    );
    console.log('  created test_video.mp4');
  } catch {
    console.log('  skip test_video.mp4 (ffmpeg not available)');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('[gen_fixtures] writing to', FIXTURES);
  ensureDir(FIXTURES);

  await createGodotProject();
  await createHeroSprite();
  await createPaletteChecker();
  await createAnimationSheet();
  await createTestVideo();

  console.log('[gen_fixtures] done ✓');
}

main().catch((e) => {
  console.error('[gen_fixtures] failed:', e);
  process.exit(1);
});
