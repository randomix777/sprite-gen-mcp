/**
 * Palette extraction and color analysis tools.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { ok, err, ErrorCode, timer } from './result.js';
import { withSharp } from './sharp_wrap.js';
import { validateInputFile, safeOutputPath } from './path_safety.js';

/**
 * Extract a color palette from an image using k-means-style quantization.
 * Uses sharp's built-in quantization (median-cut algorithm).
 */
export async function extractPalette(args) {
  const { image_path, colors = 16, output_path } = args;
  if (!image_path) return err(ErrorCode.INVALID_ARGUMENT, 'image_path is required', { stage: 'validation' });

  const inputCheck = validateInputFile(image_path);
  if (inputCheck && inputCheck.error) return inputCheck;

  const elapsed = timer();
  const { default: sharp } = await import('sharp');

  return withSharp(async () => {

  // Quantize to N colors using median-cut
  // NOTE: removeAlpha() produces RGB (3 channels), NOT RGBA (4 channels)
  const { data, info } = await sharp(image_path)
    .removeAlpha()
    .flatten({ background: { r: 255, g: 0, b: 255 } }) // magenta bg → remove later
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stride = info.channels; // 3 for RGB, 4 for RGBA — must match actual output
  // Simple frequency-based palette extraction
  const colorCounts = {};
  const step = Math.max(1, Math.floor(data.length / (10000 * stride))); // subsample for speed

  for (let i = 0; i + stride <= data.length; i += stride * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // After removeAlpha, alpha channel is gone — skip it

    // Quantize to 4-bit precision for grouping
    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    const key = `${qr},${qg},${qb}`;
    colorCounts[key] = (colorCounts[key] || 0) + 1;
  }

  // Sort by frequency and take top N
  const sorted = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, colors);

  const palette = sorted.map(([key, count]) => {
    const [r, g, b] = key.split(',').map(Number);
    return { r, g, b, hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`, count };
  });

  // Sort by brightness for a nice swatch display
  palette.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));

  if (output_path) {
    const outResult = safeOutputPath(output_path, { inputPaths: [image_path] });
    if (outResult.error) return outResult.error;
    const outData = palette.map(c => c.hex).join('\n');
    writeFileSync(outResult.resolved, outData);
  }

  return ok({
    palette,
    color_count: palette.length,
    output_path,
  }, { duration_ms: elapsed() });
  }); // end withSharp
}

/**
 * Analyze a sprite sheet for quality control metrics.
 */
export async function qcReport(args) {
  const { image_path, cell_width, cell_height } = args;
  if (!image_path) return err(ErrorCode.INVALID_ARGUMENT, 'image_path is required', { stage: 'validation' });
  if (!existsSync(image_path)) return err(ErrorCode.FILE_NOT_FOUND, `Image not found: ${image_path}`, { stage: 'validation' });

  const elapsed = timer();
  const { default: sharp } = await import('sharp');
  return withSharp(async () => {
  const meta = await sharp(image_path).metadata();
  const w = meta.width;
  const h = meta.height;

  const cols = Math.round(w / cell_width);
  const rows = Math.round(h / cell_height);
  const totalFrames = cols * rows;

  // Sample each frame for transparency, color diversity, and edge contact
  const frameStats = [];
  let edgeTouchCount = 0;
  let emptyFrameCount = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cell_width;
      const y = row * cell_height;
      const frameBuf = await sharp(image_path)
        .extract({ left: x, top: y, width: cell_width, height: cell_height })
        .removeAlpha()
        .flatten({ background: { r: 255, g: 0, b: 255, alpha: 1 } })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // After removeAlpha + flatten, channels = 3 (RGB)
      const pixels = frameBuf.data;
      const channels = frameBuf.info.channels;
      const totalPixels = Math.floor(pixels.length / channels);
      let magentaPixels = 0;
      let nonTransparent = 0;
      let colorSet = new Set();

      for (let i = 0; i < pixels.length; i += channels) {
        const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        if (r === 255 && g === 0 && b === 255) {
          magentaPixels++;
        } else if (r > 10 || g > 10 || b > 10) {
          nonTransparent++;
          const qr = Math.round(r / 32) * 32;
          const qg = Math.round(g / 32) * 32;
          const qb = Math.round(b / 32) * 32;
          colorSet.add(`${qr},${qg},${qb}`);
        }
      }

      // Check edge contact — scan all 4 edges
      let edgeTouch = false;
      const checkEdge = (px, py) => {
        const idx = (py * cell_width + px) * channels;
        return pixels[idx] > 10 || pixels[idx+1] > 10 || pixels[idx+2] > 10;
      };
      // Top and bottom edges
      for (let px = 0; px < cell_width; px++) {
        if (checkEdge(px, 0) || checkEdge(px, cell_height - 1)) {
          edgeTouch = true;
          break;
        }
      }
      // Left and right edges
      if (!edgeTouch) {
        for (let py = 0; py < cell_height; py++) {
          if (checkEdge(0, py) || checkEdge(cell_width - 1, py)) {
            edgeTouch = true;
            break;
          }
        }
      }
      if (edgeTouch) edgeTouchCount++;
      if (nonTransparent === 0) emptyFrameCount++;

      frameStats.push({
        index: row * cols + col,
        transparency_ratio: magentaPixels / totalPixels,
        content_ratio: nonTransparent / totalPixels,
        color_diversity: colorSet.size,
        edge_touch: edgeTouch,
      });
    }
  }

  const problematic = frameStats.filter(f => f.edge_touch || f.content_ratio < 0.01);

  return ok({
    grid: { cols, rows },
    total_frames: totalFrames,
    cell_size: [cell_width, cell_height],
    image_size: [w, h],
    qc_summary: {
      frames_with_edge_touch: edgeTouchCount,
      empty_or_near_empty_frames: emptyFrameCount,
      problematic_frame_count: problematic.length,
      avg_content_ratio: frameStats.reduce((s, f) => s + f.content_ratio, 0) / frameStats.length,
      avg_color_diversity: frameStats.reduce((s, f) => s + f.color_diversity, 0) / frameStats.length,
    },
    frame_stats: frameStats,
    recommendations: [
      edgeTouchCount > 0 ? `⚠ ${edgeTouchCount} frame(s) touch cell edges — consider regenerating with more padding` : '✓ No edge-touch issues',
      emptyFrameCount > 0 ? `⚠ ${emptyFrameCount} empty frame(s) detected` : '✓ No empty frames',
    ].filter(Boolean),
  }, { duration_ms: elapsed() });
  }); // end withSharp
}
