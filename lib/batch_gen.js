/**
 * Batch generation — generate multiple assets with bounded concurrency.
 *
 * Provider concurrency is enforced inside generateImage() via providerSemaphore.
 * This module just fans out tasks and preserves input order.
 */
import { ok, err, ErrorCode, unwrapImages } from './result.js';
import { LIMITS } from './limits.js';
import { parallelLimit } from './concurrency.js';
import { safeOutputPath, validateOutputPath } from './path_safety.js';

/**
 * Batch generate sprite sheets for multiple prompts.
 * Concurrency is bounded by providerSemaphore inside generateImage.
 */
export async function batchGenerate(args, ctx) {
  const { items, provider } = args;
  if (!Array.isArray(items) || items.length === 0) return err(ErrorCode.INVALID_ARGUMENT, 'items array is required', { stage: 'validation' });

  const cfg = await import('./config.js');
  const config = cfg.loadConfig();
  const providerId = provider || config.defaultProvider || 'agnes';

  const results = [];
  let errors = 0;

  // Create task functions (preserving input order)
  // Use a high parallelism limit since the real throttling happens inside generateImage
  const tasks = items.map((item, i) => async () => {
    try {
      const { generateImage } = await import('./image_gen.js');
      const gen = await generateImage({
        provider: providerId,
        prompt: item.prompt,
        width: item.width ?? 1024,
        height: item.height ?? 1024,
        num_images: 1,
      });

      if (!gen.success || !unwrapImages(gen)) {
        errors++;
        return { index: i, success: false, error: gen.error?.message || 'No images generated', prompt: item.prompt };
      }

      const { writeFileSync } = await import('fs');
      const outputPath = item.output_path || `./output/batch_${i}.png`;
      const outResult = safeOutputPath(outputPath);
      if (outResult.error) {
        errors++;
        return { index: i, success: false, error: outResult.error.error.message, prompt: item.prompt };
      }
      const unwrapped = unwrapImages(gen);
      const buffer = Buffer.from(unwrapped.images[0].data, 'base64');
      writeFileSync(outResult.resolved, buffer);

      return { index: i, success: true, output_path: outResult.resolved, prompt: item.prompt };
    } catch (e) {
      errors++;
      return { index: i, success: false, error: e.message, prompt: item.prompt };
    }
  });

  // Run with high parallelism — real throttling happens inside generateImage via providerSemaphore
  const taskResults = await parallelLimit(tasks, Math.min(items.length, LIMITS.sprite.maxBatchGenerateItems));
  for (const r of taskResults) {
    if (r instanceof Error) {
      errors++;
      results.push({ success: false, error: r.message });
    } else {
      if (!r.success) errors++;
      results.push(r);
    }
  }

  return ok({
    total: items.length,
    succeeded: items.length - errors,
    failed: errors,
    results,
  });
}

/**
 * Batch process existing images through the sprite sheet pipeline.
 * Uses bounded concurrency for Python subprocesses.
 */
export async function batchProcess(args) {
  const { items } = args;
  if (!Array.isArray(items) || items.length === 0) return err(ErrorCode.INVALID_ARGUMENT, 'items array is required', { stage: 'validation' });

  const maxConcurrent = LIMITS.concurrency.maxPython;
  let errors = 0;

  const tasks = items.map((item, i) => async () => {
    try {
      // Validate output path before passing to Python
      if (item.output_path) {
        const pathErr = validateOutputPath(item.output_path, [item.image_path]);
        if (pathErr) {
          errors++;
          return { index: i, success: false, error: pathErr.error };
        }
      }
      const { runPythonScript } = await import('./utils.js');
      const result = await runPythonScript({
        image_path: item.image_path,
        grid_cols: item.grid_cols ?? 4,
        grid_rows: item.grid_rows ?? 4,
        crop_mode: item.crop_mode ?? 'auto',
        output_path: item.output_path,
      });
      if (!result.success) errors++;
      return { index: i, success: result.success, ...result };
    } catch (e) {
      errors++;
      return { index: i, success: false, error: e.message };
    }
  });

  const taskResults = await parallelLimit(tasks, maxConcurrent);
  const results = taskResults.map(r => r instanceof Error ? { success: false, error: r.message } : r);

  return ok({
    total: items.length,
    succeeded: items.length - errors,
    failed: errors,
    results,
  });
}
