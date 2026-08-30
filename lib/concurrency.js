/**
 * Semaphore-based concurrency limiter for sprite-gen MCP server.
 *
 * Ensures bounded parallelism for:
 *   - AI provider requests
 *   - ffmpeg tasks
 *   - Python tasks
 *   - Sharp image tasks
 */

/**
 * Create a concurrency limiter (semaphore).
 * @param {number} maxConcurrent — maximum parallel operations
 * @returns {{ acquire: (opts?) => Promise<() => void>, running: () => number, queued: () => number }}
 */
export function createSemaphore(maxConcurrent) {
  let running = 0;
  const queue = [];

  return {
    /**
     * Acquire a slot. Returns a release function when the slot is granted.
     *
     * @param {object} [opts]
     * @param {AbortSignal} [opts.signal] — if provided, acquisition can be cancelled.
     *   Rejects with { code: 'CANCELLED' } if the signal fires while waiting.
     *   If the signal is already aborted, rejects immediately.
     *   Cleaned up from the wait queue on abort.
     * @returns {Promise<() => void>}
     */
    acquire(opts) {
      const signal = opts?.signal;

      // Fast reject if already aborted
      if (signal?.aborted) {
        return Promise.reject(Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' }));
      }

      return new Promise((resolve, reject) => {
        let settled = false;

        const tryAcquire = () => {
          if (settled) return; // already handled by abort
          if (running < maxConcurrent) {
            running++;
            settled = true;
            cleanup();
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              running--;
              if (queue.length > 0) {
                queue.shift()();
              }
            };
            resolve(release);
          } else {
            queue.push(tryAcquire);
          }
        };

        const myIdx = queue.length; // index at which tryAcquire was pushed

        // Abort handler: remove from wait queue, reject
        const onAbort = () => {
          if (settled) return; // already resolved or already being handled by tryAcquire
          settled = true;
          // tryAcquire hasn't run yet — remove it from the queue
          const pos = queue.indexOf(tryAcquire);
          if (pos !== -1) queue.splice(pos, 1);
          reject(Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' }));
        };

        const cleanup = () => {
          if (signal) signal.removeEventListener('abort', onAbort);
        };

        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        tryAcquire();
      });
    },

    /**
     * Number of currently running operations.
     */
    running() { return running; },

    /**
     * Number of waiting operations.
     */
    queued() { return queue.length; },
  };
}

/**
 * Run a task with concurrency limiting.
 * @param {() => Promise<T>} task — async task function
 * @param {Semaphore} semaphore — the semaphore to acquire
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] — cancellation signal
 * @returns {Promise<T>}
 */
export async function withConcurrency(task, semaphore, opts) {
  const release = await semaphore.acquire(opts);
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Run multiple tasks with bounded concurrency, preserving input order.
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} maxConcurrent
 * @returns {Promise<Array<T|Error>>}
 */
export async function parallelLimit(tasks, maxConcurrent) {
  const sem = createSemaphore(maxConcurrent);
  let idx = 0;

  const results = new Array(tasks.length);
  const workers = [];

  const runNext = async () => {
    while (idx < tasks.length) {
      const i = idx++;
      const release = await sem.acquire();
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = e;
      } finally {
        release();
      }
    }
  };

  // Start maxConcurrent workers
  for (let w = 0; w < Math.min(maxConcurrent, tasks.length); w++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  return results;
}

// ─── Pre-configured semaphores (import these singletons) ────────────────────

import { LIMITS } from './limits.js';

/** AI provider requests (default: 3) */
export const providerSemaphore = createSemaphore(LIMITS.concurrency.maxProvider);

/** ffmpeg tasks (default: 2) */
export const ffmpegSemaphore = createSemaphore(LIMITS.concurrency.maxFfmpeg);

/** Python script tasks (default: 2) */
export const pythonSemaphore = createSemaphore(LIMITS.concurrency.maxPython);

/** Sharp image processing tasks (default: 4) */
export const sharpSemaphore = createSemaphore(LIMITS.concurrency.maxSharp);
