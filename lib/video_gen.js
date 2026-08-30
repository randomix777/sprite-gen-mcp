/**
 * Video-to-sprite-sheet conversion using ffmpeg + sharp.
 *
 * Security hardening:
 *   - Isolated temp directories per operation
 *   - ffmpeg parameter validation (no shell injection)
 *   - File size and frame count limits
 *   - FPS and scale bounds
 *   - Guaranteed cleanup via finally
 */

import { existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { ok, err, ErrorCode, artifact, timer } from './result.js';
import { LIMITS } from './limits.js';
import { createTempDir, cleanupTempDir } from './temp.js';
import { validateOutputPath, validateVideoInput } from './path_safety.js';
import { runFfmpegAsync, commandExistsAsync } from './runner.js';
import { createMetrics } from './metrics.js';
import { withSharp } from './sharp_wrap.js';

/**
 * Convert a video clip into a pixel-art sprite sheet.
 */
export async function videoToSpriteSheet(args) {
  const {
    video_path,
    fps = 8,
    pixel_scale = 4,
    colors = 32,
    columns,
    output_path,
  } = args;

  if (!video_path) return err(ErrorCode.INVALID_ARGUMENT, 'video_path is required', { stage: 'validation' });

  // Validate numeric inputs BEFORE clamping — reject NaN, Infinity, zero, negative
  const rawFps = Number(fps);
  const rawScale = Number(pixel_scale);
  const rawColors = Number(colors);

  if (!Number.isFinite(rawFps) || rawFps <= 0) {
    return err(ErrorCode.INVALID_ARGUMENT, `fps must be a positive finite number, got: ${fps}`, { stage: 'validation' });
  }
  if (!Number.isFinite(rawScale) || rawScale <= 0) {
    return err(ErrorCode.INVALID_ARGUMENT, `pixel_scale must be a positive finite number, got: ${pixel_scale}`, { stage: 'validation' });
  }
  if (!Number.isFinite(rawColors) || rawColors <= 0) {
    return err(ErrorCode.INVALID_ARGUMENT, `colors must be a positive finite number, got: ${colors}`, { stage: 'validation' });
  }
  if (rawFps > LIMITS.video.maxFps) {
    return err(ErrorCode.INVALID_ARGUMENT, `fps exceeds maximum: ${rawFps} > ${LIMITS.video.maxFps}`, { stage: 'validation' });
  }
  if (rawScale > LIMITS.sprite.maxPixelScale) {
    return err(ErrorCode.INVALID_ARGUMENT, `pixel_scale exceeds maximum: ${rawScale} > ${LIMITS.sprite.maxPixelScale}`, { stage: 'validation' });
  }
  if (columns !== undefined && columns !== null) {
    const rawCols = Number(columns);
    if (!Number.isFinite(rawCols) || rawCols <= 0) {
      return err(ErrorCode.INVALID_ARGUMENT, `columns must be a positive finite number, got: ${columns}`, { stage: 'validation' });
    }
  }

  if (!existsSync(video_path)) {
    return err(ErrorCode.FILE_NOT_FOUND, `Video not found: ${video_path}`, { stage: 'validation' });
  }

  // Validate video file size
  try {
    const stat = statSync(video_path);
    if (stat.size > LIMITS.video.maxFileSizeBytes) {
      return err(ErrorCode.INVALID_ARGUMENT, `Video too large: ${(stat.size / 1024 / 1024).toFixed(0)} MB (max: ${LIMITS.video.maxFileSizeBytes / 1024 / 1024} MB)`, { stage: 'validation' });
    }
  } catch (e) {
    return err(ErrorCode.FILE_NOT_FOUND, `Cannot access video: ${video_path}`, { stage: 'validation' });
  }

  // Clamp valid values
  const safeFps = Math.min(LIMITS.video.maxFps, Math.round(rawFps));
  const safeScale = Math.min(LIMITS.sprite.maxPixelScale, Math.round(rawScale));
  const safeColors = Math.min(LIMITS.sprite.maxColors, Math.round(rawColors));

  // Validate output path
  if (output_path) {
    const pathErr = validateOutputPath(output_path, [video_path]);
    if (pathErr) return pathErr;
  }

  // Check for ffmpeg (async)
  if (!await commandExistsAsync('ffmpeg', ['-version'])) {
    return err(ErrorCode.DEPENDENCY_MISSING, 'ffmpeg not found on PATH. Install from https://ffmpeg.org', { stage: 'processing' });
  }

  const elapsed = timer();
  const m = createMetrics();
  const tmpDir = createTempDir('video');
  let frameFiles = [];

  return withSharp(async () => {
  try {
    // Extract frames with validated parameters (async, non-blocking)
    m.mark('processing');
    const framePattern = path.join(tmpDir, 'frame_%04d.png');
    await runFfmpegAsync([
      '-i', video_path,
      '-vf', `fps=${safeFps},scale=-2:-2`,
      '-start_number', '0',
      '-q:v', '2',
      '-y',
      framePattern,
    ]);

    // List extracted frames (capped at maxFrames)
    for (let i = 0; i < LIMITS.video.maxFrames; i++) {
      const fp = path.join(tmpDir, `frame_${String(i).padStart(4, '0')}.png`);
      if (existsSync(fp)) frameFiles.push(fp);
      else break;
    }

    if (frameFiles.length === 0) {
      return err(ErrorCode.PROCESSING_FAILED, 'No frames extracted from video', { stage: 'processing' });
    }

    // Process with sharp — pixelate, quantize, align
    // Optimization: read metadata from first frame, then pipeline pixelate+pad
    // in one pass per frame (avoid intermediate buffer)
    const { default: sharp } = await import('sharp');

    // Get dimensions from first frame
    const firstMeta = await sharp(frameFiles[0], { limitInputPixels: LIMITS.image.maxTotalPixels }).metadata();
    const frameW = firstMeta.width || 1;
    const frameH = firstMeta.height || 1;
    const pw = Math.max(1, Math.round(frameW / safeScale));
    const ph = Math.max(1, Math.round(frameH / safeScale));

    // Process all frames in parallel — single pipeline per frame (pixelate + pad)
    // Process in batches to limit memory pressure
    const BATCH_SIZE = LIMITS.concurrency.maxSharp;
    const frames = [];
    for (let batch = 0; batch < frameFiles.length; batch += BATCH_SIZE) {
      const batchFiles = frameFiles.slice(batch, batch + BATCH_SIZE);
      const batchResults = await Promise.all(
        batchFiles.map(async (fp) => {
          const buf = await sharp(fp, { limitInputPixels: LIMITS.image.maxTotalPixels })
            .resize(pw, ph, { fit: 'fill', kernel: 'nearest' })
            .removeAlpha()
            .flatten({ background: { r: 255, g: 0, b: 255, alpha: 1 } })
            .toBuffer();
          return buf;
        })
      );
      frames.push(...batchResults.map(buffer => ({ buffer, width: pw, height: ph })));
    }

    // Find bounding box
    let maxWidth = 0, maxHeight = 0;
    for (const f of frames) {
      maxWidth = Math.max(maxWidth, f.width);
      maxHeight = Math.max(maxHeight, f.height);
    }

    // Pad all frames to same size (skip if all already same size)
    let padded;
    const allSameSize = frames.every(f => f.width === pw && f.height === ph);
    if (allSameSize) {
      padded = frames.map(f => f.buffer); // No padding needed
    } else {
      padded = await Promise.all(
        frames.map(async ({ buffer }) => {
          return await sharp(buffer)
            .resize(pw, ph, { fit: 'contain', background: { r: 255, g: 0, b: 255, alpha: 0 } })
            .toBuffer();
        })
      );
    }

    // Assemble sprite sheet
    const cols = columns ? Math.max(1, Math.min(LIMITS.sprite.maxGridDimension, Math.round(columns))) : Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / cols);

    // Validate total output pixels don't exceed limit
    const totalOutPixels = maxWidth * cols * maxHeight * rows;
    if (totalOutPixels > LIMITS.image.maxTotalPixels * 4) {
      return err(ErrorCode.INVALID_ARGUMENT, `Output sprite sheet too large: ${maxWidth * cols}×${maxHeight * rows}`, { stage: 'processing' });
    }

    let sheet = await sharp({
      create: {
        width: maxWidth * cols,
        height: maxHeight * rows,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 0 },
      },
    })
      .composite(padded.map((buf, i) => ({
        input: buf,
        left: (i % cols) * maxWidth,
        top: Math.floor(i / cols) * maxHeight,
      })))
      .png()
      .toBuffer();

    // Apply color quantization if requested
    if (safeColors < 256) {
      sheet = await sharp(sheet)
        .removeAlpha()
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .png({ colors: safeColors })
        .toBuffer();
    }

    const finalPath = output_path || path.join(process.cwd(), 'output', `video_sprite_${Date.now()}.png`);
    mkdirSync(path.dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, sheet);

    // Count actual unique colors in the quantized output
    let actualUniqueColors = 0;
    try {
      const { data, info } = await sharp(finalPath).raw().toBuffer({ resolveWithObject: true });
      const colorSet = new Set();
      const ch = info.channels;
      for (let i = 0; i < data.length; i += ch) {
        // Include alpha in color key
        const key = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`;
        colorSet.add(key);
      }
      actualUniqueColors = colorSet.size;
    } catch (_) {
      actualUniqueColors = -1;
    }

    // Collect metrics
    m.setOutputBytes(sheet.length);
    m.setFrameCount(frames.length);
    m.mark('output');
    m.set('pixel_scale', safeScale);
    m.set('colors', safeColors);
    m.set('grid_cols', cols);
    m.set('grid_rows', rows);

    return ok({
      output_path: finalPath,
      frame_count: frames.length,
      grid: { cols, rows },
      cell_size: [maxWidth, maxHeight],
      pixel_scale: safeScale,
      colors: safeColors,
      actual_unique_colors: actualUniqueColors,
      metrics: m.toJSON(),
    }, { artifacts: [artifact('image', finalPath, { mime_type: 'image/png', size_bytes: sheet.length })], duration_ms: elapsed() });
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message?.slice(0, 500), { stage: 'processing', cause: e.stack?.slice(0, 200) });
  } finally {
    cleanupTempDir(tmpDir);
  }
  }); // end withSharp
}

/**
 * Extract individual frames from a video as separate PNGs.
 */
export async function extractVideoFrames(args) {
  const { video_path, fps = 8, output_dir } = args;

  // Validate numeric inputs BEFORE clamping
  const rawFps = Number(fps);
  if (!Number.isFinite(rawFps) || rawFps <= 0) {
    return err(ErrorCode.INVALID_ARGUMENT, `fps must be a positive finite number, got: ${fps}`, { stage: 'validation' });
  }
  if (rawFps > LIMITS.video.maxFps) {
    return err(ErrorCode.INVALID_ARGUMENT, `fps exceeds maximum: ${rawFps} > ${LIMITS.video.maxFps}`, { stage: 'validation' });
  }

  const videoCheck = validateVideoInput(video_path);
  if (videoCheck && videoCheck.error) return videoCheck;

  const safeFps = Math.min(LIMITS.video.maxFps, Math.round(rawFps));

  if (!await commandExistsAsync('ffmpeg', ['-version'])) {
    return err(ErrorCode.DEPENDENCY_MISSING, 'ffmpeg not found on PATH', { stage: 'processing' });
  }

  const elapsed = timer();
  const dir = output_dir || path.join(process.cwd(), 'output', 'video_frames');
  mkdirSync(dir, { recursive: true });

  const pattern = path.join(dir, 'frame_%04d.png');
  try {
    await runFfmpegAsync([
      '-i', video_path,
      '-vf', `fps=${safeFps}`,
      '-start_number', '0',
      '-q:v', '2',
      '-y',
      pattern,
    ]);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message?.slice(0, 500), { stage: 'processing', cause: e.stack?.slice(0, 200) });
  }

  const files = [];
  for (let i = 0; i < LIMITS.video.maxFrames; i++) {
    const fp = path.join(dir, `frame_${String(i).padStart(4, '0')}.png`);
    if (existsSync(fp)) files.push(fp);
    else break;
  }

  return ok({ frame_count: files.length, output_dir: dir, files }, { duration_ms: elapsed() });
}
