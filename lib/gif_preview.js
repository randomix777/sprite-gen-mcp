/**
 * GIF preview generator — creates animated GIFs from sprite sheets.
 * Uses sharp for frame extraction and gifsicle for encoding.
 *
 * Security hardening:
 *   - Isolated temp directories per operation
 *   - Image dimension validation (decompression bomb guard)
 *   - Frame count limits
 *   - Safe subprocess calls
 *   - Guaranteed cleanup via finally
 */

import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { ok, err, ErrorCode, artifact, timer } from './result.js';
import { LIMITS } from './limits.js';
import { createTempDir, cleanupTempDir, tempFile } from './temp.js';
import { runGifsicleAsync, commandExistsAsync } from './runner.js';
import { createMetrics } from './metrics.js';
import { withSharp } from './sharp_wrap.js';
import { validateInputFile } from './path_safety.js';

/**
 * Generate an animated GIF from a sprite sheet.
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

  // Validate input image exists and is a regular file
  const inputCheck = validateInputFile(image_path, { allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'] });
  if (inputCheck && inputCheck.error) return inputCheck;

  if (!image_path) return err(ErrorCode.INVALID_ARGUMENT, 'image_path is required', { stage: 'validation' });
  if (!cell_width) return err(ErrorCode.INVALID_ARGUMENT, 'cell_width is required', { stage: 'validation' });
  if (!existsSync(image_path)) {
    return err(ErrorCode.FILE_NOT_FOUND, `Image not found: ${image_path}`, { stage: 'validation' });
  }

  // Validate cell dimensions
  const safeCellW = Math.max(1, Math.min(LIMITS.image.maxWidth, Math.round(Number(cell_width) || 1)));
  const safeCellH = Math.max(1, Math.min(LIMITS.image.maxHeight, Math.round(Number(cell_height || cell_width) || 1)));
  const safeFps = Math.max(1, Math.min(LIMITS.sprite.maxGridDimension, Math.round(Number(fps) || 8)));

  const elapsed = timer();
  const m = createMetrics();
  const tmpDir = createTempDir('gif');
  let framePaths = [];

  return withSharp(async () => {
  try {
    // Use sharp to split the sprite sheet into frames
    const { default: sharp } = await import('sharp');
    const image = sharp(image_path, { limitInputPixels: LIMITS.image.maxTotalPixels });
    const meta = await image.metadata();

    if (!meta.width || !meta.height) {
      return err(ErrorCode.PROCESSING_FAILED, 'Cannot read image dimensions', { stage: 'processing' });
    }

    const w = meta.width;
    const h = meta.height;

    // Validate dimensions
    if (w > LIMITS.image.maxWidth || h > LIMITS.image.maxHeight) {
      return err(ErrorCode.INVALID_ARGUMENT, `Image too large: ${w}×${h} (max: ${LIMITS.image.maxWidth}×${LIMITS.image.maxHeight})`, { stage: 'validation' });
    }

    const cols = grid_cols || Math.round(w / safeCellW);
    const rows = grid_rows || Math.round(h / safeCellH);
    const frameCount = cols * rows;

    if (frameCount < 1 || frameCount > LIMITS.sprite.maxOutputFiles) {
      return err(ErrorCode.INVALID_ARGUMENT, `Invalid frame count: ${frameCount} (must be 1-${LIMITS.sprite.maxOutputFiles})`, { stage: 'processing' });
    }

    // Extract frames to temp directory (with unique names)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * safeCellW;
        const y = row * safeCellH;
        const framePath = tempFile(tmpDir, '.png');
        await sharp(image_path)
          .extract({ left: x, top: y, width: safeCellW, height: safeCellH })
          .toFile(framePath);
        framePaths.push(framePath);
      }
    }

    // Build GIF from frames
    const gifPath = output_path || path.join(process.cwd(), 'output', `preview_${Date.now()}.gif`);
    const gifDir = path.dirname(gifPath);
    mkdirSync_safe(gifDir);

    // Try gifsicle first (faster, better quality) — async, non-blocking
    m.mark('processing');
    if (await commandExistsAsync('gifsicle')) {
      try {
        const delay = Math.round(1000 / safeFps);
        await runGifsicleAsync([
          '--optimize=3',
          `--delay=${delay}`,
          '--loop',
          ...framePaths,
          `--output=${gifPath}`,
        ]);
        m.mark('output');
        m.setFrameCount(frameCount);
        return ok({ gif_path: gifPath, frames: frameCount, fps: safeFps, metrics: m.toJSON() }, {
          artifacts: [artifact('gif', gifPath, { mime_type: 'image/gif' })],
          duration_ms: elapsed(),
        });
      } catch (_) {
        // Fall through to sharp-based GIF
      }
    }

    // Fallback: use sharp to create a multi-frame animated GIF
    const frameBuffers = await Promise.all(
      framePaths.map(fp => sharp(fp).png().toBuffer())
    );
    const canvas = sharp({
      create: {
        width: safeCellW,
        height: safeCellH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
    canvas.composite(frameBuffers.map((buf) => ({ input: buf })));
    await canvas
      .gif({ animated: true, delay: Math.round(1000 / safeFps), loop: 0 })
      .toFile(gifPath);

    m.mark('output');
    m.setFrameCount(frameCount);
    return ok({ gif_path: gifPath, frames: frameCount, fps: safeFps, metrics: m.toJSON() }, {
      artifacts: [artifact('gif', gifPath, { mime_type: 'image/gif' })],
      duration_ms: elapsed(),
    });
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, `GIF generation failed: ${e.message?.slice(0, 500)}`, { stage: 'processing', cause: e.stack?.slice(0, 200) });
  } finally {
    cleanupTempDir(tmpDir);
  }
  }); // end withSharp
}

/**
 * Safe mkdirSync wrapper
 */
function mkdirSync_safe(dir) {
  try { mkdirSync(dir, { recursive: true }); } catch (_) {}
}

/**
 * Generate a multi-direction GIF preview (4-way walk cycle).
 */
export async function generateDirectionalGifs(args) {
  const { image_path, cell_width, fps = 8 } = args;
  if (!image_path || !cell_width) {
    return err(ErrorCode.INVALID_ARGUMENT, 'image_path and cell_width are required', { stage: 'validation' });
  }
  if (!existsSync(image_path)) {
    return err(ErrorCode.FILE_NOT_FOUND, `Image not found: ${image_path}`, { stage: 'validation' });
  }

  const { default: sharp } = await import('sharp');
  const meta = await sharp(image_path, { limitInputPixels: LIMITS.image.maxTotalPixels }).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

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
      cell_width: Number(cell_width),
      cell_height: Number(cell_width),
      fps,
      grid_cols: Math.floor(dirW / Number(cell_width)),
      grid_rows: Math.floor(dirH / Number(cell_width)),
      output_path: gifPath,
    });
    if (result.success) results.push({ direction: dirs[d], ...result });
  }

  return ok({ results });
}
