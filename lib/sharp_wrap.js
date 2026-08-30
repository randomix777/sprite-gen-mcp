/**
 * Sharp image processing wrapper with concurrency limiting.
 *
 * All heavy Sharp operations should use withSharp() to ensure
 * the sharpSemaphore is respected.
 *
 * Cancellation semantics:
 *   - If signal is already aborted → rejects with CANCELLED immediately, no permit acquired.
 *   - If signal fires while waiting for permit → removes from queue, rejects with CANCELLED.
 *   - If signal fires after permit acquired but before pipeline starts → releases permit, rejects.
 *   - If signal fires during pipeline execution → pipeline observes signal via argument;
 *     the native Sharp operation already submitted to libvips cannot be interrupted.
 *     The pipeline can cooperatively check signal.throwIfAborted() between Sharp calls.
 */

import sharp from 'sharp';
import { sharpSemaphore } from './concurrency.js';

/**
 * Execute a Sharp pipeline with concurrency limiting and cancellation.
 *
 * @template T
 * @param {({ signal: AbortSignal }) => Promise<T>} pipeline
 *   Async function receiving { signal } for cooperative cancellation.
 *   Must check signal.throwIfAborted() between Sharp operations.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] — cancellation signal
 * @returns {Promise<T>}
 * @throws {Error & { code: 'CANCELLED' }} if cancelled before or during acquire
 */
export async function withSharp(pipeline, options = {}) {
  const { signal } = options;

  // Fast reject if already aborted (no permit acquired)
  if (signal?.aborted) {
    throw Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' });
  }

  // Acquire with abort support — removes from queue on abort
  const release = await sharpSemaphore.acquire({ signal });
  try {
    // Re-check after acquire — signal may have fired while waiting was nearly done
    if (signal?.aborted) {
      throw Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' });
    }
    try {
      return await pipeline({ signal });
    } catch (e) {
      // If pipeline called signal.throwIfAborted(), the native AbortError
      // doesn't carry our CANCELLED code. Wrap it for consistent semantics.
      if (e.name === 'AbortError' && signal?.aborted) {
        throw Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' });
      }
      throw e;
    }
  } finally {
    release();
  }
}

/**
 * Create a pre-configured sharp instance with concurrency limiting.
 * The concurrency is enforced at the service boundary, not per-call.
 *
 * @param {string} input — image path or Buffer
 * @param {object} [options] — sharp options
 * @returns {sharp.Sharp} sharp instance (concurrency managed by caller)
 */
export function createSharp(input, options) {
  return sharp(input, options);
}
