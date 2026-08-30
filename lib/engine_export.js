/**
 * Engine export utilities — TexturePacker JSON, Aseprite JSON, and Godot scene generation.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ok, err, ErrorCode, artifact } from './result.js';
import { validateInputFile, safeOutputPath } from './path_safety.js';

/**
 * Export sprite sheet to TexturePacker JSON Hash format.
 * Works with Unity, Godot, and most engines.
 */
export async function exportTexturePacker(args) {
  const { image_path, cell_width, cell_height, output_path, prefix = 'frame' } = args;
  if (!image_path || !cell_width) return err(ErrorCode.INVALID_ARGUMENT, 'image_path and cell_width required', { stage: 'validation' });

  const inputCheck = validateInputFile(image_path);
  if (inputCheck && inputCheck.error) return inputCheck;

  const { default: sharp } = await import('sharp');
  const meta = await sharp(image_path).metadata();
  const w = meta.width;
  const h = meta.height;
  const cols = Math.round(w / cell_width);
  const rows = Math.round(h / cell_height);
  const total = cols * rows;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    frames.push({
      filename: `${prefix}_${String(i).padStart(3, '0')}.png`,
      framedata: {
        x: col * cell_width,
        y: row * cell_height,
        w: cell_width,
        h: cell_height,
      },
    });
  }

  const output = {
    meta: {
      image: path.basename(image_path),
      format: 'RGBA8888',
      size: { w, h },
      scale: 1,
      smartupdate: '',
    },
    frames,
  };

  const outPath = output_path || path.join(path.dirname(image_path), `tpacker_${randomUUID().slice(0, 6)}.json`);
  const outResult = safeOutputPath(outPath, { inputPaths: [image_path] });
  if (outResult.error) return outResult.error;
  writeFileSync(outResult.resolved, JSON.stringify(output, null, 2));

  return ok({ output_path: outResult.resolved, frame_count: total, grid: { cols, rows } }, { artifacts: [artifact('json', outResult.resolved)] });
}

/**
 * Export sprite sheet to Aseprite JSON format.
 */
export async function exportAseprite(args) {
  const { image_path, cell_width, cell_height, fps = 8, output_path } = args;
  if (!image_path || !cell_width) return err(ErrorCode.INVALID_ARGUMENT, 'image_path and cell_width required', { stage: 'validation' });

  const inputCheck = validateInputFile(image_path);
  if (inputCheck && inputCheck.error) return inputCheck;

  const { default: sharp } = await import('sharp');
  const meta = await sharp(image_path).metadata();
  const w = meta.width;
  const h = meta.height;
  const cols = Math.round(w / cell_width);
  const rows = Math.round(h / cell_height);
  const total = cols * rows;

  const frameDuration = Math.round(1000 / fps);

  const output = {
    format: 'rgba4444',
    frames: [],
    duration: frameDuration,
    tags: [{ name: 'default', from: 0, to: total - 1 }],
  };

  for (let i = 0; i < total; i++) {
    output.frames.push({
      src: path.basename(image_path),
      frame: { x: (i % cols) * cell_width, y: Math.floor(i / cols) * cell_height, w: cell_width, h: cell_height },
      duration: frameDuration,
    });
  }

  const outPath = output_path || path.join(path.dirname(image_path), `aseprite_${randomUUID().slice(0, 6)}.json`);
  const outResult = safeOutputPath(outPath, { inputPaths: [image_path] });
  if (outResult.error) return outResult.error;
  writeFileSync(outResult.resolved, JSON.stringify(output, null, 2));

  return ok({ output_path: outResult.resolved, frame_count: total }, { artifacts: [artifact('json', outResult.resolved)] });
}

/**
 * Generate a minimal Godot 4 .tscn scene file with a Sprite2D node.
 */
export async function exportGodotScene(args) {
  const {
    image_path,
    cell_width,
    cell_height = cell_width,
    output_path,
    node_name = 'Character',
    position = { x: 0, y: 0 },
    animations,
  } = args;
  if (!image_path || !cell_width) return err(ErrorCode.INVALID_ARGUMENT, 'image_path and cell_width required', { stage: 'validation' });

  const inputCheck = validateInputFile(image_path);
  if (inputCheck && inputCheck.error) return inputCheck;

  // Read image dimensions
  let imgW, imgH;
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(image_path).metadata();
    imgW = meta.width;
    imgH = meta.height;
  } catch (_) {
    imgW = cell_width * 4;
    imgH = cell_height * 4;
  }

  const cols = Math.round(imgW / cell_width);
  const rows = Math.round(imgH / cell_height);
  const totalFrames = cols * rows;

  const anims = animations || { idle: { start: 0, end: Math.min(3, totalFrames - 1), loop: true } };
  const animNames = Object.keys(anims);
  const defaultAnim = animNames[0] || 'idle';

  // Build animation list
  const animList = animNames.map((name) => {
    const a = anims[name];
    return `${name}=${a.start}-${a.end}:${a.loop ? 'loop' : 'oneshot'}`;
  }).join(',');

  const relImage = path.basename(image_path);
  const uuid = randomUUID().slice(0, 8);

  const scene = `[gd_scene load_steps=3 format=3]
ext_resource=1 "Texture2D" "${relImage}"
sub_resource=2 "SpriteFrames"
sub_resources = [SubResource(2)]
resource={
"frames": {
"${defaultAnim}": SubResource(2)
}
}

[node name="${node_name}" type="Sprite2D"]
texture = ExtResource(1)
region_enabled = true
region_rect = Rect2(0, 0, ${cell_width}, ${cell_height})
frames = SubResource(2)
offset = Vector2(${cell_width / 2}, ${cell_height})
position = Vector2(${position.x}, ${position.y})
`;

  const outPath = output_path || path.join(path.dirname(image_path), `${node_name.toLowerCase()}.tscn`);
  const outResult = safeOutputPath(outPath, { inputPaths: [image_path] });
  if (outResult.error) return outResult.error;
  writeFileSync(outResult.resolved, scene);

  return ok({
    output_path: outResult.resolved,
    node_name,
    grid: { cols, rows },
    total_frames: totalFrames,
    default_animation: defaultAnim,
  }, { artifacts: [artifact('scene', outResult.resolved)] });
}
