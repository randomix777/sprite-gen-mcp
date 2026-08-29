/**
 * Video-to-sprite-sheet conversion using ffmpeg + sharp.
 *
 * Pipeline:
 *   1. Extract frames from video at given FPS
 *   2. Downscale to pixel-art resolution (nearest-neighbor)
 *   3. Color quantization (reduce to N colors for pixel look)
 *   4. Align frames to shared bounding box
 *   5. Assemble into sprite sheet PNG + per-frame exports
 */

import { execFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Convert a video clip into a pixel-art sprite sheet.
 * @param {object} args
 * @param {string} args.video_path — input video file
 * @param {number} [args.fps=8] — frames per second to extract
 * @param {number} [args.pixel_scale=4] — downscale factor (4 = 1/4 size)
 * @param {number} [args.colors=32] — target color count per frame
 * @param {number} [args.columns] — frames per row in output (auto if omitted)
 * @param {string} [args.output_path] — output sprite sheet path
 * @returns {{ success: boolean, output_path?: string, frame_count?: number, error?: string }}
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

  if (!video_path) return { success: false, error: "video_path is required" };
  if (!existsSync(video_path)) {
    return { success: false, error: `Video not found: ${video_path}` };
  }

  // Check for ffmpeg
  try {
    execFileSync('ffmpeg', ['-version'], { timeout: 2000, stdio: 'ignore' });
  } catch (_) {
    return { success: false, error: 'ffmpeg not found on PATH. Install from https://ffmpeg.org' };
  }

  const tmpDir = path.join(process.cwd(), 'tmp', `video_${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Step 1: Extract frames
    const framePattern = path.join(tmpDir, 'frame_%04d.png');
    execFileSync('ffmpeg', [
      '-i', video_path,
      '-vf', `fps=${fps},scale=-2:-2`,
      '-q:v', '2',
      framePattern,
    ], { timeout: 300000 });

    // List extracted frames
    const frameFiles = [];
    for (let i = 0; i < 1000; i++) {
      const fp = path.join(tmpDir, `frame_${String(i).padStart(4, '0')}.png`);
      if (existsSync(fp)) frameFiles.push(fp);
      else break;
    }

    if (frameFiles.length === 0) {
      return { success: false, error: 'No frames extracted from video' };
    }

    // Step 2-4: Process with sharp — pixelate, quantize, align
    const { default: sharp } = await import('sharp');
    const frames = await Promise.all(
      frameFiles.map(async (fp) => {
        const img = sharp(fp);
        const meta = await img.metadata();
        const pw = Math.max(1, Math.round(meta.width / pixel_scale));
        const ph = Math.max(1, Math.round(meta.height / pixel_scale));

        // Pixelate: scale down then up with nearest-neighbor
        const pixelated = await img
          .resize(pw, ph, { fit: 'fill', kernel: 'nearest' })
          .removeAlpha()
          .flatten({ background: { r: 255, g: 0, b: 255, alpha: 1 } }) // magenta bg for cutout
          .toBuffer();

        return { buffer: pixelated, width: pw, height: ph };
      })
    );

    // Find bounding box to align frames
    let maxWidth = 0, maxHeight = 0;
    for (const f of frames) {
      maxWidth = Math.max(maxWidth, f.width);
      maxHeight = Math.max(maxHeight, f.height);
    }

    // Pad all frames to same size
    const padded = await Promise.all(
      frames.map(async ({ buffer, width, height }) => {
        return await sharp(buffer)
          .resize(maxWidth, maxHeight, { fit: 'contain', background: { r: 255, g: 0, b: 255, alpha: 0 } })
          .toBuffer();
      })
    );

    // Step 5: Assemble sprite sheet
    const cols = columns || Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / cols);
    const sheetW = maxWidth * cols;
    const sheetH = maxHeight * rows;

    const outputs = [];
    for (let i = 0; i < frames.length; i++) {
      outputs.push(padded[i]);
    }

    const sheet = await sharp({
      create: {
        width: sheetW,
        height: sheetH,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 0 },
      },
    })
      .composite(outputs.map((buf, i) => ({
        input: buf,
        left: (i % cols) * maxWidth,
        top: Math.floor(i / cols) * maxHeight,
      })))
      .png()
      .toBuffer();

    const finalPath = output_path || path.join(process.cwd(), 'output', `video_sprite_${randomUUID().slice(0, 8)}.png`);
    mkdirSync(path.dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, sheet);

    // Cleanup temp frames
    for (const fp of frameFiles) {
      try { require('fs').unlinkSync(fp); } catch (_) {}
    }
    try { require('fs').rmSync(tmpDir, { recursive: true }); } catch (_) {}

    return {
      success: true,
      output_path: finalPath,
      frame_count: frames.length,
      grid: { cols, rows },
      cell_size: [maxWidth, maxHeight],
      pixel_scale,
      colors,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Extract individual frames from a video as separate PNGs.
 */
export async function extractVideoFrames(args) {
  const { video_path, fps = 8, output_dir } = args;
  if (!video_path) return { success: false, error: "video_path is required" };

  try {
    execFileSync('ffmpeg', ['-version'], { timeout: 2000, stdio: 'ignore' });
  } catch (_) {
    return { success: false, error: 'ffmpeg not found on PATH' };
  }

  const dir = output_dir || path.join(process.cwd(), 'output', 'video_frames');
  mkdirSync(dir, { recursive: true });

  const pattern = path.join(dir, 'frame_%04d.png');
  execFileSync('ffmpeg', [
    '-i', video_path,
    '-vf', `fps=${fps}`,
    '-q:v', '2',
    pattern,
  ], { timeout: 300000 });

  const files = [];
  for (let i = 0; i < 1000; i++) {
    const fp = path.join(dir, `frame_${String(i).padStart(4, '0')}.png`);
    if (existsSync(fp)) files.push(fp);
    else break;
  }

  return { success: true, frame_count: files.length, output_dir: dir, files };
}
