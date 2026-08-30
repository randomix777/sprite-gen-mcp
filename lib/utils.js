/**
 * Shared utilities — avoids circular dependencies between index.js and sub-modules.
 *
 * Security hardening:
 *   - File size validation before write
 *   - Path normalization and boundary check
 *   - Safe subprocess execution
 *   - Decompression bomb protection via sharp limits
 */
import { writeFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { err, ErrorCode } from './result.js';
import { LIMITS } from './limits.js';
import { createMetrics } from './metrics.js';
import { validateOutputPath, validateInputFile } from './path_safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Save generated image data (base64) to disk and return the absolute path.
 * Validates file size and path safety before writing.
 */
export function saveGeneratedImage(data, mimeType, outputPath) {
  const validationErr = validateOutputPath(outputPath);
  if (validationErr) throw new Error(validationErr.error.message);

  const abs = path.resolve(outputPath);
  const buffer = Buffer.from(data, 'base64');

  if (buffer.length > LIMITS.image.maxFileSizeBytes) {
    throw new Error(`Image data too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (max: ${LIMITS.image.maxFileSizeBytes / 1024 / 1024} MB)`);
  }

  writeFileSync(abs, buffer);
  return abs;
}

/**
 * Run the Python sprite processing script (async, non-blocking).
 * Returns parsed JSON result with metrics.
 */
export async function runPythonScript(args) {
  const scriptPath = path.join(__dirname, 'process_sprites.py');
  const m = createMetrics();
  m.mark('processing');
  try {
    const { runPythonAsync } = await import('./runner.js');
    const result = await runPythonAsync(scriptPath, args);
    m.mark('output');
    // Merge metrics into result if it's a success object
    if (result && typeof result === 'object') {
      result.metrics = m.toJSON();
    }
    return result;
  } catch (e) {
    const msg = e.message?.slice(0, 500) || 'Python script failed';
    return err(ErrorCode.PROCESSING_FAILED, msg, { stage: 'processing', cause: e.stack?.slice(0, 200) });
  }
}

/**
 * Validate image dimensions to prevent decompression bombs.
 * Uses sharp's built-in limit via the pipeline, but also checks metadata.
 * @param {string} imagePath — path to image file
 * @returns {{ width: number, height: number } | { error: object }}
 */
export async function validateImageDimensions(imagePath) {
  try {
    const { default: sharp } = await import('sharp');
    const metadata = await sharp(imagePath, {
      limitInputPixels: LIMITS.image.maxTotalPixels,
    }).metadata();

    if (metadata.width > LIMITS.image.maxWidth || metadata.height > LIMITS.image.maxHeight) {
      return err(ErrorCode.INVALID_ARGUMENT,
        `Image too large: ${metadata.width}×${metadata.height} (max: ${LIMITS.image.maxWidth}×${LIMITS.image.maxHeight})`,
        { stage: 'validation' }
      );
    }

    if (metadata.width * metadata.height > LIMITS.image.maxTotalPixels) {
      return err(ErrorCode.INVALID_ARGUMENT,
        `Image has too many pixels: ${metadata.width * metadata.height} (max: ${LIMITS.image.maxTotalPixels})`,
        { stage: 'validation' }
      );
    }

    return { width: metadata.width, height: metadata.height };
  } catch (e) {
    if (e.message?.includes('Input file is too large') || e.message?.includes('pixel')) {
      return err(ErrorCode.INVALID_ARGUMENT, 'Image file may be a decompression bomb — rejected', { stage: 'validation' });
    }
    return err(ErrorCode.PROCESSING_FAILED, `Cannot read image: ${e.message}`, { stage: 'validation' });
  }
}

/**
 * Validate numeric parameters are safe.
 * Returns the clamped/validated value, or throws.
 */
export function validateNumber(value, name, { min = 1, max = Infinity, allowFloat = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number, got: ${value}`);
  }
  if (!allowFloat && !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer, got: ${value}`);
  }
  if (n < min) throw new Error(`${name} must be >= ${min}, got: ${n}`);
  if (n > max) throw new Error(`${name} must be <= ${max}, got: ${n}`);
  return n;
}
