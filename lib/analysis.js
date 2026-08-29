/**
 * Palette extraction and color analysis tools.
 */

import { existsSync } from 'fs';

/**
 * Extract a color palette from an image using k-means-style quantization.
 * Uses sharp's built-in quantization (median-cut algorithm).
 */
export async function extractPalette(args) {
  const { image_path, colors = 16, output_path } = args;
  if (!image_path) return { success: false, error: 'image_path is required' };
  if (!existsSync(image_path)) return { success: false, error: `Image not found: ${image_path}` };

  const { default: sharp } = await import('sharp');

  // Quantize to N colors using median-cut
  const { data, info } = await sharp(image_path)
    .removeAlpha()
    .flatten({ background: { r: 255, g: 0, b: 255 } }) // magenta bg → remove later
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Simple frequency-based palette extraction
  const colorCounts = {};
  const stride = 4; // rgba
  const step = Math.max(1, Math.floor(data.length / (10000 * stride))); // subsample for speed

  for (let i = 0; i < data.length; i += stride * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 32) continue; // skip transparent

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
    const fs = (await import('fs')).default;
    const outData = palette.map(c => c.hex).join('\n');
    fs.mkdirSync(require('path').dirname(output_path), { recursive: true });
    fs.writeFileSync(output_path, outData);
  }

  return {
    success: true,
    palette,
    color_count: palette.length,
    output_path,
  };
}

/**
 * Analyze a sprite sheet for quality control metrics.
 */
export async function qcReport(args) {
  const { image_path, cell_width, cell_height } = args;
  if (!image_path) return { success: false, error: 'image_path is required' };
  if (!existsSync(image_path)) return { success: false, error: `Image not found: ${image_path}` };

  const { default: sharp } = await import('sharp');
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
        .toBuffer();

      const pixels = new Uint8Array(frameBuf);
      const totalPixels = pixels.length / 4;
      let magentaPixels = 0;
      let nonTransparent = 0;
      let colorSet = new Set();

      for (let i = 0; i < pixels.length; i += 4) {
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

      // Check edge contact
      let edgeTouch = false;
      const checkEdge = (px, py) => {
        const idx = (py * cell_width + px) * 4;
        return pixels[idx] > 10 || pixels[idx+1] > 10 || pixels[idx+2] > 10;
      };
      for (let px = 0; px < cell_width; px++) {
        if (checkEdge(px, 0) || checkEdge(px, cell_height-1) ||
            checkEdge(0, py) || checkEdge(cell_width-1, py)) {
          edgeTouch = true;
          break;
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

  return {
    success: true,
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
  };
}
