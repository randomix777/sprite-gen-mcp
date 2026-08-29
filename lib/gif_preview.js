/**
 * GIF preview generator — creates animated GIFs from sprite sheets.
 * Uses sharp for frame extraction and gifsicle for encoding.
 */

import { execFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Generate an animated GIF from a sprite sheet.
 * @param {object} args
 * @param {string} args.image_path — source sprite sheet PNG
 * @param {number} args.cell_width — individual frame width
 * @param {number} args.cell_height — individual frame height
 * @param {number} [args.fps=8] — frames per second
 * @param {number} [args.grid_cols] — override grid columns detection
 * @param {number} [args.grid_rows] — override grid rows detection
 * @param {string} [args.output_path] — output GIF path (auto-generated if omitted)
 * @returns {{ success: boolean, gif_path?: string, frames?: number, error?: string }}
 */
export async function generateGifPreview(args) {
  const {
    image_path,
    cell_width,
    cell_height,
    fps = 8,
    grid_cols,
    grid_rows,
    output_path,
  } = args;

  if (!image_path) return { success: false, error: "image_path is required" };
  if (!cell_width) return { success: false, error: "cell_width is required" };
  if (!existsSync(image_path)) {
    return { success: false, error: `Image not found: ${image_path}` };
  }

  const tmpDir = path.join(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Use sharp to split the sprite sheet into frames
  const { default: sharp } = await import('sharp');
  const image = sharp(image_path);
  const meta = await image.metadata();
  const w = meta.width;
  const h = meta.height;

  const cols = grid_cols || Math.round(w / cell_width);
  const rows = grid_rows || Math.round(h / cell_height);
  const frameCount = cols * rows;

  if (frameCount < 1) {
    return { success: false, error: 'Invalid grid dimensions' };
  }

  // Extract frames to temp directory
  const framePaths = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cell_width;
      const y = row * cell_height;
      const framePath = path.join(tmpDir, `frame_${randomUUID()}.png`);
      await sharp(image_path)
        .extract({ left: x, top: y, width: cell_width, height: cell_height })
        .toFile(framePath);
      framePaths.push(framePath);
    }
  }

  // Build GIF from frames
  const gifPath = output_path || path.join(process.cwd(), 'output', `preview_${randomUUID().slice(0, 8)}.gif`);
  const gifDir = path.dirname(gifPath);
  mkdirSync(gifDir, { recursive: true });

  try {
    // Try gifsicle first (faster, better quality)
    const gifsiclePath = findGifsicle();
    if (gifsiclePath) {
      const result = execFileSync(gifsiclePath, [
        '--optimize=3',
        '--delay=' + Math.round(1000 / fps),
        '--loop',
        ...framePaths,
        '--output=' + gifPath,
      ], { timeout: 60000 });
      return { success: true, gif_path: gifPath, frames: frameCount, fps };
    }

    // Fallback: use sharp to create a multi-frame GIF
    const frames = await Promise.all(
      framePaths.map(fp => sharp(fp).jpeg().toBuffer())
    );
    await sharp({
      create: {
        width: cell_width,
        height: cell_height * rows,
        channels: 3,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(frames.map((buf, i) => ({ input: buf, top: 0, left: 0 })))
      .gif()
      .toFile(gifPath);

    return { success: true, gif_path: gifPath, frames: frameCount, fps };
  } catch (err) {
    return { success: false, error: `GIF generation failed: ${err.message}` };
  } finally {
    // Cleanup temp frames
    for (const fp of framePaths) {
      try { existsSync(fp) && require('fs').unlinkSync(fp); } catch (_) {}
    }
  }
}

/**
 * Find gifsicle binary on PATH (Windows/Mac/Linux).
 */
function findGifsicle() {
  const candidates = ['gifsicle', 'gifsicle.exe'];
  for (const name of candidates) {
    try {
      execFileSync(name, ['--version'], { timeout: 1000, stdio: 'ignore' });
      return name;
    } catch (_) {}
  }
  return null;
}

/**
 * Generate a multi-direction GIF preview (4-way walk cycle).
 */
export async function generateDirectionalGifs(args) {
  const { image_path, cell_width, fps = 8 } = args;
  if (!image_path || !cell_width) {
    return { success: false, error: "image_path and cell_width are required" };
  }
  if (!existsSync(image_path)) {
    return { success: false, error: `Image not found: ${image_path}` };
  }

  const { default: sharp } = await import('sharp');
  const meta = await sharp(image_path).metadata();
  const w = meta.width;
  const h = meta.height;

  // Assume 4 directions: right, down, left, up (each is a 2x2 or similar grid)
  const dirs = ['right', 'down', 'left', 'up'];
  const results = [];

  for (let d = 0; d < dirs.length; d++) {
    const startX = (d % 2) * Math.floor(w / 2);
    const startY = Math.floor(d / 2) * Math.floor(h / 2);
    const dirW = Math.floor(w / 2);
    const dirH = Math.floor(h / 2);

    const gifPath = path.join(process.cwd(), 'output', `preview_${dirs[d]}.gif`);
    const result = await generateGifPreview({
      image_path,
      cell_width,
      cell_height: cell_width,
      fps,
      grid_cols: Math.floor(dirW / cell_width),
      grid_rows: Math.floor(dirH / cell_height),
      output_path: gifPath,
    });
    if (result.success) results.push({ direction: dirs[d], ...result });
  }

  return { success: true, results };
}
