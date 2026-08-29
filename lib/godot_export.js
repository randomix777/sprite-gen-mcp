/**
 * Godot SpriteFrames export — generate .tres files from sprite sheets.
 *
 * Outputs a Godot 4 SpriteFrames resource that can be dragged directly
 * into the editor. Also writes a companion JSON metadata file.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Generate a Godot 4 SpriteFrames .tres file.
 * @param {object} args
 * @param {string} args.image_path — path to the sprite sheet PNG
 * @param {number} args.cell_width — individual frame width
 * @param {number} [args.cell_height] — frame height (defaults to cell_width)
 * @param {string} args.output_path — path for the .tres file
 * @param {object} [args.animations] — named animation definitions
 *   e.g. { idle: { start: 0, end: 3, fps: 8 }, walk: { start: 4, end: 7, fps: 8 } }
 * @returns {{ success: boolean, tre_path?: string, metadata?: object, error?: string }}
 */
export async function exportGodotSpriteFrames(args) {
  const {
    image_path,
    cell_width,
    cell_height = cell_width,
    output_path,
    animations,
  } = args;

  if (!image_path) return { success: false, error: "image_path is required" };
  if (!cell_width || cell_width < 1) return { success: false, error: "cell_width is required" };
  if (!output_path) return { success: false, error: "output_path is required" };
  if (!existsSync(image_path)) {
    return { success: false, error: `Image not found: ${image_path}` };
  }

  // Read image dimensions using sharp
  let width, height;
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(image_path).metadata();
    width = meta.width;
    height = meta.height;
  } catch (err) {
    return { success: false, error: `Cannot read image: ${err.message}` };
  }

  const cols = Math.round(width / cell_width);
  const rows = Math.round(height / cell_height);
  const totalFrames = cols * rows;

  if (cols < 1 || rows < 1) {
    return { success: false, error: `Invalid grid: ${cols}x${rows} from ${width}x${height} with cell ${cell_width}x${cell_height}` };
  }

  // Default animations if none provided
  const anims = animations || {
    idle: { start: 0, end: Math.min(totalFrames - 1, 3), loop: true, fps: 8 },
  };

  const absPath = path.resolve(output_path);
  const dir = path.dirname(absPath);
  mkdirSync(dir, { recursive: true });

  // Generate the .tres file
  const tresContent = generateTresContent(
    path.basename(image_path),
    cell_width,
    cell_height,
    cols,
    anims,
  );
  writeFileSync(absPath, tresContent, 'utf8');

  // Write JSON metadata
  const metaPath = absPath.replace('.tres', '.json');
  const metadata = {
    image_path,
    cell_size: [cell_width, cell_height],
    grid: { cols, rows },
    total_frames: totalFrames,
    animations: Object.entries(anims).map(([name, a]) => ({
      name,
      frame_start: a.start,
      frame_end: a.end,
      frame_count: a.end - a.start + 1,
      fps: a.fps,
      loop: a.loop ?? true,
    })),
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  return {
    success: true,
    tre_path: absPath,
    metadata_path: metaPath,
    grid: { cols, rows },
    total_frames: totalFrames,
    animations: Object.keys(anims),
  };
}

/**
 * Build Godot 4 SpriteFrames .tres text format content.
 */
function generateTresContent(textureName, cellW, cellH, cols, anims) {
  const lines = [];
  const animEntries = Object.entries(anims);

  // Header
  lines.push('[gd_scene load_steps=2 format=3]');
  lines.push(`[ext_resource type="Texture2D" path="res://${textureName}" id="1_png"]`);
  lines.push('[resource]');

  // ext_resources
  lines.push('  ext_resources = []');

  // sub_resources — build array of SubResource references
  const subEntries = animEntries.map(([name]) => `"SpriteFrames_${name}": [ SubResource("SpriteFrames_${name}") ]`);
  lines.push(`  sub_resources = { ${subEntries.join(', ')} }`);

  // resources — first animation is the default
  if (animEntries.length > 0) {
    const firstAnim = animEntries[0][0];
    lines.push(`  resources = { "frames_0": SubResource("SpriteFrames_${firstAnim}") }`);
  }

  // Each animation as a sub_resource
  for (const [name, anim] of animEntries) {
    lines.push(`[sub_resource type="SpriteFrames" id="SpriteFrames_${name}"]`);
    lines.push('  texture = ExtResource("1_png")');
    lines.push(`  region = Rect2i(0, 0, ${cellW}, ${cellH})`);
    lines.push(`  frame_count = ${anim.end - anim.start + 1}`);
    lines.push('  frames = [');

    for (let i = anim.start; i <= anim.end; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      lines.push('    {');
      lines.push(`      "texture_offset": Vector2i(${col} * ${cellW}, ${row} * ${cellH})`);
      lines.push(`      "duration": ${Math.round(1000 / anim.fps)}`);
      lines.push('    },');
    }

    lines.push('  ]');
    lines.push(`  loop = ${anim.loop ? 'true' : 'false'}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Auto-detect grid from a sprite sheet and suggest animation ranges.
 */
export async function autoDetectAnimations(imagePath, cellWidth) {
  let width, height;
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(imagePath).metadata();
    width = meta.width;
    height = meta.height;
  } catch (_) {
    return { success: false, error: 'Cannot read image metadata' };
  }

  const cols = Math.round(width / cellWidth);
  const rows = Math.round(height / cellWidth);
  const total = cols * rows;

  const suggestions = {};
  if (total >= 4) {
    const half = Math.floor(total / 2);
    suggestions.idle = { start: 0, end: half - 1, fps: 8 };
    suggestions.walk = { start: half, end: total - 1, fps: 8 };
  } else {
    suggestions.idle = { start: 0, end: total - 1, fps: 8 };
  }

  return {
    success: true,
    grid: { cols, rows },
    total_frames: total,
    suggested_animations: suggestions,
  };
}
