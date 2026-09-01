/**
 * Machine Asset Gates — Quality Control System.
 *
 * All generated assets pass through these hard gates before being accepted.
 * Three statuses: APPROVED, REVIEW_REQUIRED, REJECTED.
 * Each gate outputs rule ID, measured value, threshold, status, and evidence.
 *
 * Hard gates are non-negotiable: any single failure → REJECTED.
 * Review gates flag borderline cases: → REVIEW_REQUIRED.
 *
 * Pixel data layout contract (single source of truth):
 *  - meta.channels / info.channels drives EVERYTHING (1=gray, 2=gray+alpha,
 *    3=rgb, 4=rgba). No helper guesses stride; the stride is derived here.
 *  - alphaMask is ALWAYS a single-channel Uint8Array of length w*h (1=body,0=transparent).
 *  - RGB sampling uses `stride = channels` and starts at pixel*stride.
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import path from 'path';
import { ok, err, ErrorCode, timer } from './result.js';
import { validateInputFile } from './path_safety.js';

// ─── Status constants ──────────────────────────────────────────────────────────
export const QC_STATUS = {
  APPROVED: 'APPROVED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  REJECTED: 'REJECTED',
};

// ─── Default thresholds ────────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = {
  // File gates
  maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  minDimensions: 16,
  maxDimensions: 8192,
  // Alpha / transparency gates
  cornerAlphaMax: 13,           // max alpha in corner pixels (0-255)
  minTransparencyRatio: 0.20,   // at least 20% transparent
  maxTransparencyRatio: 0.95,   // not more than 95% transparent (no near-empty)
  // Body composition gates
  minBodyRatio: 0.15,           // body must occupy at least 15% of canvas
  maxBodyRatio: 0.75,           // body must not exceed 75% of canvas
  maxEdgeMarginPercent: 0.04,   // body must be ≥4% away from each edge
  maxNoiseRatio: 0.01,          // tiny isolated noise ≤1% of body area
  // Ground anchor gate
  maxGroundAnchorOffsetPercent: 0.02,
  // Background contamination gates
  maxWhiteCornerRatio: 0.05,    // ≤5% of edges should be white (not transparent)
  maxCheckerboardRatio: 0.001,  // no checkerboard patterns allowed
};

// Style-profile overrides. When auditAssets is given a style_profile, these
// thresholds are merged on top of DEFAULT_THRESHOLDS so the style is actually
// enforced (not just recorded).
const STYLE_PROFILES = {
  // Furniture/cover props: body can be a bit larger, slightly looser edges.
  cover_prop: { minBodyRatio: 0.18, maxBodyRatio: 0.80, maxEdgeMarginPercent: 0.03, maxGroundAnchorOffsetPercent: 0.05, maxCheckerboardRatio: 0.01 },
  // Sprites: standard.
  sprite: {},
  // UI: highly transparent, small body allowed.
  ui: { minTransparencyRatio: 0.35, maxBodyRatio: 0.95, maxEdgeMarginPercent: 0.02 },
  // Tilesets: must tile cleanly → tighter edge margins (higher required margin).
  tileset: { maxEdgeMarginPercent: 0.08, minBodyRatio: 0.10 },
  // Effects: very transparent, fine noise tolerated.
  effect: { minTransparencyRatio: 0.45, maxNoiseRatio: 0.05 },
  // Animation frames: consistent with sprite.
  animation: {},
};

function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

/**
 * Run all QC gates on an image file.
 * @returns {{ success, data:{ status, rules, evidence_path, measurements, ... }, error }}
 */
export async function qcGate(args) {
  const {
    image_path,
    canvas_width,
    canvas_height,
    ground_anchor,
    thresholds = {},
  } = args;

  // style_profile is carried inside `thresholds` by auditAssets; pull it out and
  // apply the matching profile overrides so the style is genuinely enforced.
  const { style_profile, ...explicitThresholds } = thresholds;
  const styleOverrides = style_profile && STYLE_PROFILES[style_profile] ? STYLE_PROFILES[style_profile] : {};

  if (!image_path) return err(ErrorCode.INVALID_ARGUMENT, 'image_path is required', { stage: 'validation' });
  if (typeof image_path !== 'string') return err(ErrorCode.INVALID_ARGUMENT, 'image_path must be a string', { stage: 'validation' });

  const inputCheck = validateInputFile(image_path);
  if (inputCheck && inputCheck.error) return inputCheck;

  if (!existsSync(image_path)) {
    return err(ErrorCode.FILE_NOT_FOUND, `Image not found: ${image_path}`, { stage: 'validation' });
  }

  const elapsed = timer();
  const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...styleOverrides, ...explicitThresholds };

  const rules = [];
  let hasHardFailure = false;
  let hasReviewFlag = false;
  const evidence = {};
  let body = null; // assigned after per-pixel analysis; finalize() reads it
  let hasAlphaCh = false; // assigned once channels known

  const add = (id, description, value, threshold, passed) => {
    const entry = addRule(id, description, value, threshold, passed, evidence);
    rules.push(entry);
    if (!passed) hasHardFailure = true;
    return entry;
  };
  // A hard failure that must also record a finite-measurement invariant.
  const hardFail = (id, description, value, threshold) => add(id, description, value, threshold, false);

  // ─── Gate 1: File integrity (real metadata + real stat) ────────────────────
  let meta, rawData, rawInfo, fileSizeBytes = 0, statError = null;
  try {
    const { default: sharp } = await import('sharp');
    meta = await sharp(image_path).metadata();
    const raw = await sharp(image_path).raw().toBuffer({ resolveWithObject: true });
    rawData = raw.data;
    rawInfo = raw.info;
  } catch (e) {
    hardFail('FILE_DECODE', 'Image could not be decoded', { error: String(e.message).slice(0, 200) }, { decodable: true });
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: null, height: null });
  }

  const w = meta.width, h = meta.height;
  const channels = rawInfo.channels;
  const format = meta.format;

  // FILE_FORMAT — real decoded format (furniture assets require PNG)
  const fmtOk = format === 'png';
  add('FILE_FORMAT', 'Image must be a valid PNG file',
    { format, channels, width: w, height: h },
    { required_format: 'png' }, fmtOk);

  // DIMENSIONS_RANGE — finite + within bounds
  const dimsOk = isFiniteNum(w) && isFiniteNum(h) &&
    w >= mergedThresholds.minDimensions && h >= mergedThresholds.minDimensions &&
    w <= mergedThresholds.maxDimensions && h <= mergedThresholds.maxDimensions;
  add('DIMENSIONS_RANGE', `Dimensions must be ${mergedThresholds.minDimensions}–${mergedThresholds.maxDimensions}`,
    { width: w, height: h },
    { min: mergedThresholds.minDimensions, max: mergedThresholds.maxDimensions }, dimsOk);

  // CANVAS_MATCH — if expected canvas provided
  if (canvas_width && canvas_height) {
    const canvasOk = w === canvas_width && h === canvas_height;
    add('CANVAS_MATCH', `Canvas must be ${canvas_width}×${canvas_height}`,
      { actual: [w, h], expected: [canvas_width, canvas_height] },
      { expected: [canvas_width, canvas_height] }, canvasOk);
  }

  // TOTAL_PIXELS — finite + sane
  const totalPixels = w * h;
  const pixelsOk = isFiniteNum(totalPixels) && totalPixels >= mergedThresholds.minDimensions * mergedThresholds.minDimensions;
  add('TOTAL_PIXELS', 'Total pixel count must be valid',
    { total_pixels: totalPixels },
    { min: mergedThresholds.minDimensions * mergedThresholds.minDimensions }, pixelsOk);

  // FILE_SIZE — real stat, preserved diagnostic on failure
  try {
    fileSizeBytes = statSync(image_path).size;
  } catch (e) {
    statError = e.message;
  }
  const sizeOk = statError === null && isFiniteNum(fileSizeBytes) && fileSizeBytes > 0 && fileSizeBytes <= mergedThresholds.maxFileSizeBytes;
  add('FILE_SIZE', `File size must be ≤ ${mergedThresholds.maxFileSizeBytes} bytes`,
    { size_bytes: fileSizeBytes, stat_error: statError },
    { max_bytes: mergedThresholds.maxFileSizeBytes }, sizeOk);

  // DECODE_COMPLETE — exact raw length vs expected (channels-aware)
  const expectedBytes = (isFiniteNum(w) && isFiniteNum(h) && isFiniteNum(channels))
    ? w * h * channels : -1;
  const decodeOk = rawData && rawData.length === expectedBytes && expectedBytes > 0;
  add('DECODE_COMPLETE', 'Full image decoded with correct channel layout',
    { data_length: rawData ? rawData.length : 0, expected_bytes: expectedBytes, channels },
    { complete: true }, decodeOk);

  // If any file gate failed, short-circuit (we cannot trust pixel analysis).
  if (hasHardFailure) {
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: w, height: h });
  }

  // ─── Build alpha mask + RGB sampling with correct stride ───────────────────
  const stride = channels;
  let alphaMask = null;
  hasAlphaCh = (channels === 2 || channels === 4);
  if (hasAlphaCh) {
    const alphaOffset = channels === 4 ? 3 : 1; // rgba -> +3, ga -> +1
    alphaMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alphaMask[i] = rawData[i * stride + alphaOffset];
  }

  // ─── Gate 2: Alpha channel presence ────────────────────────────────────────
  if (hasAlphaCh) {
    // CORNER_ALPHA — sampled over alphaMask, corners must be transparent
    const corners = getCorners(alphaMask, w, h);
    const maxCornerAlpha = corners.length ? Math.max(...corners) : 0;
    const cornerOk = maxCornerAlpha <= mergedThresholds.cornerAlphaMax;
    add('CORNER_ALPHA', 'Corner pixels must be transparent (alpha ≤ threshold)',
      { max_corner_alpha: maxCornerAlpha, corners },
      { max: mergedThresholds.cornerAlphaMax }, cornerOk);
    if (cornerOk && maxCornerAlpha > mergedThresholds.cornerAlphaMax * 0.7) hasReviewFlag = true;
  } else {
    hardFail('HAS_ALPHA', 'Image must have an alpha channel', { has_alpha: false }, { required: true });
    // Without alpha we cannot do transparency/body analysis → reject now.
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: w, height: h });
  }

  // ─── Gate 3: Transparency ratio ────────────────────────────────────────────
  {
    let transparentCount = 0;
    for (let i = 0; i < alphaMask.length; i++) if (alphaMask[i] < 32) transparentCount++;
    const transparencyRatio = totalPixels > 0 ? transparentCount / totalPixels : 0;
    const ratioOk = transparencyRatio >= mergedThresholds.minTransparencyRatio &&
                    transparencyRatio <= mergedThresholds.maxTransparencyRatio;
    add('TRANSPARENCY_RATIO', `Transparency must be ${Math.round(mergedThresholds.minTransparencyRatio * 100)}%–${Math.round(mergedThresholds.maxTransparencyRatio * 100)}%`,
      { ratio: transparencyRatio, transparent_pixels: transparentCount, total_pixels: totalPixels },
      { min: mergedThresholds.minTransparencyRatio, max: mergedThresholds.maxTransparencyRatio }, ratioOk);
    if (ratioOk && (transparencyRatio < mergedThresholds.minTransparencyRatio * 1.2 ||
                    transparencyRatio > mergedThresholds.maxTransparencyRatio * 0.95)) hasReviewFlag = true;
  }

  // ─── Gate 4: Body composition from MAX connected component ─────────────────
  body = extractBody(alphaMask, w, h);
  const bboxOk = body.valid && body.bbox && body.width > 0 && body.height > 0;
  add('BODY_BBOX', 'Body bounding box (max connected component) must be valid',
    { bbox: body.bbox, body_area: body.area, canvas_area: w * h },
    { min_body_px: 1 }, bboxOk);

  if (!bboxOk) {
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: w, height: h });
  }

  const [bx, by, bw, bh] = body.bbox;
  const leftMargin = bx / w;
  const rightMargin = (w - bx - bw) / w;
  const topMargin = by / h;
  const bottomMargin = (h - by - bh) / h;
  const minMargin = Math.min(leftMargin, rightMargin, topMargin, bottomMargin);
  const marginOk = minMargin >= mergedThresholds.maxEdgeMarginPercent;
  add('EDGE_MARGIN', `Body must stay ≥${Math.round(mergedThresholds.maxEdgeMarginPercent * 100)}% from canvas edges`,
    { left: leftMargin, right: rightMargin, top: topMargin, bottom: bottomMargin, min: minMargin },
    { min_percent: mergedThresholds.maxEdgeMarginPercent }, marginOk);
  if (!marginOk) hasReviewFlag = true; // borderline but not hard unless below absolute floor later

  const bodyRatio = body.area / (w * h);
  const bodyRatioOk = bodyRatio >= mergedThresholds.minBodyRatio && bodyRatio <= mergedThresholds.maxBodyRatio;
  add('BODY_RATIO', `Body area must be ${Math.round(mergedThresholds.minBodyRatio * 100)}%–${Math.round(mergedThresholds.maxBodyRatio * 100)}% of canvas`,
    { body_ratio: bodyRatio, body_area: body.area, canvas_area: w * h },
    { min: mergedThresholds.minBodyRatio, max: mergedThresholds.maxBodyRatio }, bodyRatioOk);
  if (!bodyRatioOk) hasReviewFlag = true;

  // CONNECTED_COMPONENTS — main vs isolated noise (real measurements)
  const noiseOk = body.noiseRatio <= mergedThresholds.maxNoiseRatio;
  add('CONNECTED_COMPONENTS', `Isolated noise must not exceed ${Math.round(mergedThresholds.maxNoiseRatio * 100)}% of body area`,
    { main_area: body.mainArea, noise_area: body.noiseArea, noise_ratio: body.noiseRatio, component_count: body.components.length },
    { max_noise_ratio: mergedThresholds.maxNoiseRatio }, noiseOk);
  if (!noiseOk) hasReviewFlag = true;

  // ─── Gate 5: Background contamination (stride-aware) ───────────────────────
  const contamination = detectBackgroundContamination(rawData, alphaMask, w, h, stride);
  add('WHITE_BACKGROUND', 'No solid white/colored background at edges',
    { white_edge_ratio: contamination.whiteEdgeRatio },
    { max: mergedThresholds.maxWhiteCornerRatio }, contamination.whiteEdgeRatio <= mergedThresholds.maxWhiteCornerRatio);
  add('CHECKERBOARD', 'No checkerboard or grid pattern in background',
    { checkerboard_score: contamination.checkerboardScore },
    { max: mergedThresholds.maxCheckerboardRatio }, contamination.checkerboardScore <= mergedThresholds.maxCheckerboardRatio);

  // ─── Gate 6: Ground anchor (optional) ──────────────────────────────────────
  if (ground_anchor && body.centroid) {
    const [gx, gy] = ground_anchor;
    const [cx, cy] = body.centroid;
    const offsetY = Math.abs(cy + body.height * 0.5 - gy) / h;
    const anchorOk = offsetY <= mergedThresholds.maxGroundAnchorOffsetPercent;
    add('GROUND_ANCHOR', 'Body bottom must align with ground anchor',
      { offset_y: offsetY, body_bottom: cy + body.height * 0.5, anchor_y: gy },
      { max_offset_percent: mergedThresholds.maxGroundAnchorOffsetPercent }, anchorOk);
    if (!anchorOk) hasReviewFlag = true;
  }

  // ─── Evidence generation (strict: failure = REJECTED) ──────────────────────
  let evidencePath = null;
  try {
    evidencePath = await generateEvidenceImage(image_path, body, w, h);
  } catch (e) {
    hardFail('EVIDENCE_GENERATION', 'Evidence image generation failed', { error: String(e.message).slice(0, 200) }, {});
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: w, height: h });
  }
  if (typeof evidencePath !== 'string' || !existsSync(evidencePath)) {
    hardFail('EVIDENCE_GENERATION', 'Evidence image missing after generation', { evidence_path: evidencePath }, {});
    return finalize(QC_STATUS.REJECTED, rules, null, elapsed, hasAlphaCh, body, { width: w, height: h });
  }

  // ─── Final status ───────────────────────────────────────────────────────────
  const status = hasHardFailure ? QC_STATUS.REJECTED
    : hasReviewFlag ? QC_STATUS.REVIEW_REQUIRED
    : QC_STATUS.APPROVED;

  return finalize(status, rules, evidencePath, elapsed, hasAlphaCh, body, { width: w, height: h });

  // ── local finalize helper ──
  function finalize(status, ruleList, evPath, elapsedFn, alphaCh, bodyObj, meas) {
    const rejectedRules = ruleList.filter(r => !r.passed).map(r => r.id);
    return ok({
      status,
      rules: ruleList,
      rejected_rules: rejectedRules,
      evidence_path: evPath,
      measurements: {
        width: meas.width,
        height: meas.height,
        has_alpha: alphaCh,
        transparency_ratio: ruleList.find(r => r.id === 'TRANSPARENCY_RATIO')?.value?.ratio,
        body_ratio: ruleList.find(r => r.id === 'BODY_RATIO')?.value?.body_ratio,
        min_margin: ruleList.find(r => r.id === 'EDGE_MARGIN')?.value?.min,
        main_area: bodyObj?.mainArea,
        noise_ratio: bodyObj?.noiseRatio,
      },
    }, { duration_ms: elapsedFn() });
  }
}

// ─── Helper: single rule entry ────────────────────────────────────────────────
function addRule(id, description, value, threshold, passed, evidence) {
  const entry = { id, description, value, threshold, passed, notes: '' };
  if (!passed) entry.notes = getFailureNote(id, value, threshold);
  evidence[id] = { value, threshold, passed, note: entry.notes };
  return entry;
}

function getFailureNote(id, value, threshold) {
  switch (id) {
    case 'FILE_FORMAT': return `Format ${value.format} is not accepted PNG`;
    case 'DIMENSIONS_RANGE': return `Dimensions ${value.width}×${value.height} out of range`;
    case 'FILE_SIZE': return `File size ${value.size_bytes} bytes invalid (${value.stat_error || 'out of bounds'})`;
    case 'DECODE_COMPLETE': return `Raw length ${value.data_length} != expected ${value.expected_length}`;
    case 'CORNER_ALPHA': return `Max corner alpha ${value.max_corner_alpha} exceeds threshold ${threshold.max}`;
    case 'TRANSPARENCY_RATIO': return `Transparency ${((value.ratio ?? 0) * 100).toFixed(1)}% outside [${(threshold.min * 100).toFixed(0)}%, ${(threshold.max * 100).toFixed(0)}%]`;
    case 'EDGE_MARGIN': return `Minimum margin ${((value.min ?? 0) * 100).toFixed(1)}% below required ${(threshold.min_percent * 100).toFixed(0)}%`;
    case 'BODY_RATIO': return `Body ratio ${((value.body_ratio ?? 0) * 100).toFixed(1)}% outside [${(threshold.min * 100).toFixed(0)}%, ${(threshold.max * 100).toFixed(0)}%]`;
    case 'CONNECTED_COMPONENTS': return `Noise ratio ${((value.noise_ratio ?? 0) * 100).toFixed(2)}% exceeds ${(threshold.max_noise_ratio * 100).toFixed(0)}%`;
    case 'WHITE_BACKGROUND': return `White edge ratio ${(value.white_edge_ratio * 100).toFixed(2)}% exceeds ${(threshold.max * 100).toFixed(2)}%`;
    case 'CHECKERBOARD': return `Checkerboard score ${value.checkerboard_score.toFixed(4)} exceeds ${(threshold.max).toFixed(4)}`;
    case 'GROUND_ANCHOR': return `Ground offset ${((value.offset_y ?? 0) * 100).toFixed(1)}% exceeds ${(threshold.max_offset_percent * 100).toFixed(0)}%`;
    case 'HAS_ALPHA': return 'Image has no alpha channel';
    case 'EVIDENCE_GENERATION': return `Evidence generation failed: ${value.error || value.evidence_path || 'unknown'}`;
    default: return 'Gate failed';
  }
}

// ─── Helper: corner alpha sampling ────────────────────────────────────────────
function getCorners(alphaMask, w, h) {
  if (!alphaMask || alphaMask.length === 0) return [];
  const region = 10;
  const corners = [];
  const sample = (x, y) => corners.push(alphaMask[y * w + x] ?? 0);
  for (let y = 0; y < region; y++) for (let x = 0; x < region; x++) sample(x, y);
  for (let y = 0; y < region; y++) for (let x = w - region; x < w; x++) sample(x, y);
  for (let y = h - region; y < h; y++) for (let x = 0; x < region; x++) sample(x, y);
  for (let y = h - region; y < h; y++) for (let x = w - region; x < w; x++) sample(x, y);
  return corners;
}

/**
 * Extract the main body from an alpha mask.
 * Returns the LARGEST connected component's bbox/centroid/area plus the aggregate
 * noise (all other components) and per-component list. Uses an indexed queue BFS.
 */
export function extractBody(alphaMask, w, h) {
  if (!alphaMask || alphaMask.length !== w * h) {
    return { valid: false, bbox: null, area: 0, width: 0, height: 0, centroid: null,
             components: [], mainArea: 0, noiseArea: 0, noiseRatio: 0 };
  }
  const mask = new Uint8Array(w * h);
  let bodyPixelCount = 0;
  for (let i = 0; i < w * h; i++) {
    const v = alphaMask[i];
    mask[i] = v > 32 ? 1 : 0;
    if (v > 32) bodyPixelCount++;
  }
  if (bodyPixelCount === 0) {
    return { valid: false, bbox: null, area: 0, width: 0, height: 0, centroid: null,
             components: [], mainArea: 0, noiseArea: 0, noiseRatio: 0 };
  }

  const visited = new Uint8Array(w * h);
  const components = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const pi = sy * w + sx;
      if (mask[pi] && !visited[pi]) {
        let size = 0, minX = w, minY = h, maxX = 0, maxY = 0;
        const queue = [pi];
        let head = 0;
        visited[pi] = 1;
        while (head < queue.length) {
          const curr = queue[head++];
          size++;
          const cx = curr % w, cy = (curr - cx) / w;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          if (cy > 0 && !visited[curr - w] && mask[curr - w]) { visited[curr - w] = 1; queue.push(curr - w); }
          if (cy < h - 1 && !visited[curr + w] && mask[curr + w]) { visited[curr + w] = 1; queue.push(curr + w); }
          if (cx > 0 && !visited[curr - 1] && mask[curr - 1]) { visited[curr - 1] = 1; queue.push(curr - 1); }
          if (cx < w - 1 && !visited[curr + 1] && mask[curr + 1]) { visited[curr + 1] = 1; queue.push(curr + 1); }
        }
        components.push({
          area: size,
          bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
        });
      }
    }
  }

  components.sort((a, b) => b.area - a.area);
  const main = components[0];
  const mainArea = main ? main.area : 0;
  const noiseArea = components.slice(1).reduce((s, c) => s + c.area, 0);
  const noiseRatio = mainArea > 0 ? noiseArea / mainArea : (components.length > 1 ? 1 : 0);

  return {
    valid: !!main,
    width: main ? main.bbox[2] : 0,
    height: main ? main.bbox[3] : 0,
    bbox: main ? main.bbox : null,
    area: mainArea,
    centroid: main ? [main.cx, main.cy] : null,
    components,
    mainArea,
    noiseArea,
    noiseRatio,
  };
}

// Back-compat: computeBodyBbox now returns the MAX connected component body.
export function computeBodyBbox(rgbData, alphaMask, w, h) {
  const body = extractBody(alphaMask, w, h);
  return body;
}

// ─── Helper: detect background contamination (stride-aware) ────────────────────
function detectBackgroundContamination(rgbData, alphaMask, w, h, stride) {
  let whiteEdgePixels = 0, edgeTotal = 0;
  const sampleStep = Math.max(1, Math.floor(w / 64));
  if (!alphaMask || alphaMask.length === 0 || !rgbData) return { whiteEdgeRatio: 0, checkerboardScore: 0 };

  for (let x = 0; x < w; x += sampleStep) {
    for (let y = 0; y < 4; y++) {
      if (alphaMask[y * w + x] > 32) {
        edgeTotal++;
        const base = (y * w + x) * stride;
        if (rgbData[base] > 240 && rgbData[base + 1] > 240 && rgbData[base + 2] > 240) whiteEdgePixels++;
      }
    }
    for (let y = h - 4; y < h; y++) {
      if (alphaMask[y * w + x] > 32) {
        edgeTotal++;
        const base = (y * w + x) * stride;
        if (rgbData[base] > 240 && rgbData[base + 1] > 240 && rgbData[base + 2] > 240) whiteEdgePixels++;
      }
    }
  }

  // Checkerboard detection — multi-scale scan of the WHOLE canvas (interior + border)
  let checkerboardScore = 0;
  if (h > 8 && w > 8) {
    const scales = [1, 2, 4, 8, 16, 32, 64];
    let totalChecks = 0, flaggedChecks = 0;
    for (const scale of scales) {
      if (w < scale * 4 || h < scale * 2) continue;
      const xStep = scale >= 4 ? scale * 2 : 1;
      const rowStep = Math.max(1, Math.floor(h / 16));
      for (let row = 0; row < h; row += rowStep) {
        for (let x = 0; x < w - scale * 2; x += xStep) {
          let b1 = 0, b2 = 0, b1Opaque = 0, b2Opaque = 0;
          let b1SumR = 0, b1SumG = 0, b1SumB = 0, b2SumR = 0, b2SumG = 0, b2SumB = 0;
          let b1Total = 0, b2Total = 0;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const i1 = (row + dy) * w + x + dx;
              const i2 = (row + dy) * w + x + scale + dx;
              if (i1 >= w * h || i2 >= w * h) continue;
              b1Total++; b2Total++;
              if (alphaMask[i1] > 32) {
                b1Opaque++; b1Any(b1Opaque);
                const base1 = i1 * stride;
                b1SumR += rgbData[base1]; b1SumG += rgbData[base1 + 1]; b1SumB += rgbData[base1 + 2];
              }
              if (alphaMask[i2] > 32) {
                b2Opaque++;
                const base2 = i2 * stride;
                b2SumR += rgbData[base2]; b2SumG += rgbData[base2 + 1]; b2SumB += rgbData[base2 + 2];
              }
            }
          }
          if (b1Total < scale * scale * 0.3 || b2Total < scale * scale * 0.3) continue;
          if (b1Opaque > 0 && b2Opaque > 0) {
            totalChecks++;
            const avg1r = b1SumR / b1Opaque, avg1g = b1SumG / b1Opaque, avg1b = b1SumB / b1Opaque;
            const avg2r = b2SumR / b2Opaque, avg2g = b2SumG / b2Opaque, avg2b = b2SumB / b2Opaque;
            const dr = Math.abs(avg1r - avg2r), dg = Math.abs(avg1g - avg2g), db = Math.abs(avg1b - avg2b);
            if (dr > 80 && dg > 80 && db > 80) flaggedChecks++;
          }
        }
      }
    }
    checkerboardScore = totalChecks > 0 ? flaggedChecks / totalChecks : 0;
  }

  return {
    whiteEdgeRatio: edgeTotal > 0 ? whiteEdgePixels / edgeTotal : 0,
    checkerboardScore,
  };
}
function b1Any() {} // placeholder to satisfy minifier-free lint (unused)

// ─── Helper: generate evidence image (bbox overlay + margin markers) ─────────
async function generateEvidenceImage(imagePath, body, w, h) {
  const { default: sharp } = await import('sharp');
  const outPath = imagePath.replace(/\.png$/i, '_qc_evidence.png');
  const dir = path.dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let pipeline = sharp(imagePath);
  if (body && body.valid && body.bbox) {
    const [bx, by, bw, bh] = body.bbox;
    const overlay = Buffer.from(
      `<svg width="${w}" height="${h}">
        <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="red" stroke-width="2"/>
        <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="orange" stroke-width="1" stroke-dasharray="4,4"/>
      </svg>`
    );
    pipeline = pipeline.composite([{ input: overlay, top: 0, left: 0 }]);
  }

  await pipeline.toFile(outPath);
  if (!existsSync(outPath)) throw new Error(`Evidence image was not written to ${outPath}`);
  return outPath;
}

// ═════════════════════════════════════════════════════════════════════════════
// State consistency (intact vs variant)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Compare two sprite states for consistency.
 * @param {object} args
 * @param {string} args.reference_path
 * @param {string} args.variant_path
 * @param {string} [args.variant_type] — 'rubble' | 'open' | 'empty' | 'breached'
 * @param {object} [args.thresholds]
 */
export async function qcStateConsistency(args) {
  const { reference_path, variant_path, variant_type = 'rubble', thresholds: altThresholds = {} } = args;
  if (!reference_path || !variant_path) {
    return err(ErrorCode.INVALID_ARGUMENT, 'reference_path and variant_path are required', { stage: 'validation' });
  }
  const elapsed = timer();
  const th = { ...DEFAULT_THRESHOLDS, ...altThresholds };
  const evidence = {};
  // Declare the collector FIRST so every error path can push into it (no TDZ).
  const rules = [];
  const add = (id, description, value, threshold, passed) => {
    const entry = addRule(id, description, value, threshold, passed, evidence);
    rules.push(entry);
    return entry;
  };

  try {
    const { default: sharp } = await import('sharp');
    const [refMeta, varMeta] = await Promise.all([
      sharp(reference_path).metadata(),
      sharp(variant_path).metadata(),
    ]);

    const sizeMatch = refMeta.width === varMeta.width && refMeta.height === varMeta.height;
    add('SIZE_MATCH', 'Variant must have same canvas dimensions',
      { ref: [refMeta.width, refMeta.height], variant: [varMeta.width, varMeta.height] },
      { match: true }, sizeMatch);

    const refBbox = await computeBodyBboxFromPath(reference_path);
    const varBbox = await computeBodyBboxFromPath(variant_path);

    let centerOffset = 0, groundOffset = 0, silhouetteIoU = 0;
    let refCenterX = 0, refCenterY = 0, varCenterX = 0, varCenterY = 0;
    if (refBbox.valid && varBbox.valid) {
      const [rx, ry, rw, rh] = refBbox.bbox;
      const [vx, vy, vw, vh] = varBbox.bbox;
      refCenterX = rx + rw / 2; refCenterY = ry + rh / 2;
      varCenterX = vx + vw / 2; varCenterY = vy + vh / 2;
      const maxDim = Math.max(refMeta.width, varMeta.width, 1);
      centerOffset = Math.sqrt((refCenterX - varCenterX) ** 2 + (refCenterY - varCenterY) ** 2) / maxDim;
      const refBottom = ry + rh, varBottom = vy + vh;
      groundOffset = Math.abs(refBottom - varBottom) / refMeta.height;
      silhouetteIoU = await computeSilhouetteIoU(reference_path, variant_path);
    }

    const mirrorDetected = refBbox.valid && varBbox.valid &&
      Math.abs(refBbox.centroid[0] - (refMeta.width - varBbox.centroid[0])) < 5 &&
      Math.abs(refBbox.centroid[0] - varBbox.centroid[0]) > refMeta.width * 0.3;
    const sizeMutation = refBbox.valid && varBbox.valid &&
      (Math.abs(refBbox.area - varBbox.area) / Math.max(refBbox.area, 1)) > 0.5;

    // CENTER_OFFSET — real boolean per variant type
    const centerThreshold = variant_type === 'rubble'
      ? th.maxGroundAnchorOffsetPercent * 5
      : th.maxGroundAnchorOffsetPercent * 3;
    const centerOk = centerOffset <= centerThreshold;
    add('CENTER_OFFSET', variant_type === 'rubble'
        ? 'Body center offset (rubble — wide tolerance)'
        : 'Body center must not drift (non-destructive state)',
      { offset_ratio: centerOffset, variant_type },
      { max_ratio: centerThreshold }, centerOk);

    // GROUND_OFFSET
    const groundThreshold = variant_type === 'rubble' ? th.maxGroundAnchorOffsetPercent * 2 : th.maxGroundAnchorOffsetPercent;
    const groundOk = groundOffset <= groundThreshold;
    add('GROUND_OFFSET', 'Ground contact point must not drift',
      { offset_ratio: groundOffset, variant_type },
      { max_ratio: groundThreshold }, groundOk);

    // SILHOUETTE_IOU — strict for non-destructive, informational/lenient for rubble
    if (variant_type !== 'rubble') {
      const iouOk = silhouetteIoU >= 0.55;
      add('SILHOUETTE_IOU', 'Body silhouette must remain similar (non-destructive)',
        { iou: silhouetteIoU, variant_type },
        { min: 0.55 }, iouOk);
    } else {
      const rubbleGroundOk = refBbox.valid && varBbox.valid && groundOk && centerOk;
      add('SILHOUETTE_IOU', 'Body silhouette (rubble — material/ground consistency)',
        { iou: silhouetteIoU, variant_type, ground_ok: groundOk, center_ok: centerOk },
        { min: 0.0 }, rubbleGroundOk);
    }

    // MIRROR_DETECTION — reject horizontal flip in non-destructive states
    if (variant_type !== 'rubble') {
      add('MIRROR_DETECTION', 'No horizontal mirroring allowed',
        { mirror_detected: mirrorDetected },
        { allowed: false }, !mirrorDetected);
    }

    // SIZE_MUTATION
    add('SIZE_MUTATION', 'No sudden size change (>50%)',
      { size_mutation_detected: sizeMutation, ref_area: refBbox.area, var_area: varBbox.area },
      { allowed: false }, !sizeMutation);

    // PALETTE_DISTANCE — only over body (alpha) pixels; any error → hard failure
    let paletteDistance = null;
    try {
      paletteDistance = await computePaletteDistance(reference_path, variant_path);
      const paletteOk = paletteDistance < 0.5;
      add('PALETTE_DISTANCE', 'Material color palette must be consistent',
        { distance: paletteDistance, variant_type },
        { max: 0.5 }, paletteOk);
    } catch (e) {
      // Programming/measurement error must NOT be swallowed — hard fail.
      add('PALETTE_DISTANCE', 'Palette comparison failed (measurement error)',
        { error: String(e.message).slice(0, 200), variant_type },
        { available: true }, false);
    }

    // Aggregate: default-deny.
    const hardFailIds = new Set(['SIZE_MATCH', 'CENTER_OFFSET', 'GROUND_OFFSET', 'SILHOUETTE_IOU',
      'MIRROR_DETECTION', 'SIZE_MUTATION', 'PALETTE_DISTANCE']);
    const reviewIds = new Set(['CENTER_OFFSET', 'PALETTE_DISTANCE', 'SILHOUETTE_IOU']);
    const hardFailures = rules.filter(r => !r.passed && hardFailIds.has(r.id));
    const reviewNeeded = rules.filter(r => !r.passed && reviewIds.has(r.id) && !hardFailIds.has(r.id));

    let status;
    if (hardFailures.length > 0) status = QC_STATUS.REJECTED;
    else if (reviewNeeded.length > 0) status = QC_STATUS.REVIEW_REQUIRED;
    else status = QC_STATUS.APPROVED;

    return ok({
      status, rules, variant_type,
      measurements: {
        center_offset: centerOffset, ground_offset: groundOffset,
        silhouette_iou: silhouetteIoU, mirror_detected: mirrorDetected,
        size_mutation: sizeMutation, palette_distance: paletteDistance,
      },
      evidence,
    }, { duration_ms: elapsed() });
  } catch (e) {
    // Outer failure (decode/metric error) is a hard reject, never a silent pass.
    add('STATE_CONSISTENCY', 'State consistency check could not complete',
      { error: String(e.message).slice(0, 200) }, { completed: true }, false);
    return ok({
      status: QC_STATUS.REJECTED, rules, variant_type,
      measurements: { error: String(e.message).slice(0, 200) },
      evidence,
    }, { duration_ms: elapsed() });
  }
}

/**
 * Compute palette distance between two images, counting ONLY body (alpha) pixels.
 * Returns [0,1] where 0 = identical palettes. Uses mean RGB over alpha-masked area.
 */
async function computePaletteDistance(refPath, varPath) {
  const { default: sharp } = await import('sharp');
  const extract = async (p) => {
    const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, channels = info.channels;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < w * h; i++) {
      if (data[i * channels + 3] > 32) { // only body pixels
        rSum += data[i * channels];
        gSum += data[i * channels + 1];
        bSum += data[i * channels + 2];
        count++;
      }
    }
    if (count === 0) throw new Error('No opaque body pixels to compare palette');
    return { r: rSum / count / 255, g: gSum / count / 255, b: bSum / count / 255 };
  };
  const refColor = await extract(refPath);
  const varColor = await extract(varPath);
  return Math.sqrt(
    (refColor.r - varColor.r) ** 2 +
    (refColor.g - varColor.g) ** 2 +
    (refColor.b - varColor.b) ** 2
  ) / Math.sqrt(3);
}

async function computeBodyBboxFromPath(imagePath) {
  try {
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    let alphaMask;
    if (channels === 4) {
      alphaMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaMask[i] = data[i * 4 + 3];
    } else if (channels === 2) {
      alphaMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaMask[i] = data[i * 2 + 1];
    } else {
      alphaMask = new Uint8Array(w * h).fill(255);
    }
    return extractBody(alphaMask, w, h);
  } catch {
    return { valid: false, bbox: null, area: 0, centroid: null };
  }
}

/**
 * Compute silhouette IoU between two images using their alpha masks.
 */
async function computeSilhouetteIoU(refPath, varPath) {
  try {
    const { default: sharp } = await import('sharp');
    const [refRaw, varRaw] = await Promise.all([
      sharp(refPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(varPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    const rw = refRaw.info.width, rh = refRaw.info.height;
    const vw = varRaw.info.width, vh = varRaw.info.height;
    const minW = Math.min(rw, vw), minH = Math.min(rh, vh);
    const refMask = new Uint8Array(minW * minH);
    const varMask = new Uint8Array(minW * minH);
    for (let y = 0; y < minH; y++) {
      for (let x = 0; x < minW; x++) {
        const idxR = (y * rw + x) * 4 + 3;
        const idxV = (y * vw + x) * 4 + 3;
        refMask[y * minW + x] = (idxR < refRaw.data.length && refRaw.data[idxR] > 32) ? 1 : 0;
        varMask[y * minW + x] = (idxV < varRaw.data.length && varRaw.data[idxV] > 32) ? 1 : 0;
      }
    }
    let intersection = 0, union = 0;
    for (let i = 0; i < refMask.length; i++) {
      if (refMask[i] || varMask[i]) union++;
      if (refMask[i] && varMask[i]) intersection++;
    }
    return union > 0 ? intersection / union : 0;
  } catch {
    return 0;
  }
}
