/**
 * Performance metrics helper for sprite-gen MCP tools.
 *
 * Provides structured timing and sizing metrics per tool invocation.
 * All metrics are opaque objects — the MCP layer serializes them as-is.
 */

import { statSync } from 'node:fs';

/**
 * Create a metrics collector for a tool invocation.
 *
 * @returns {MetricsCollector}
 *
 * Usage:
 *   const m = createMetrics();
 *   m.mark('queue');        // record queue wait start
 *   // ... await queue ...
 *   m.mark('processing');   // processing started
 *   // ... do work ...
 *   m.mark('output');       // output written
 *   m.setOutputBytes(1024);
 *   m.setFrameCount(16);
 *   console.log(m.toJSON());
 */
export function createMetrics() {
  const start = performance.now();
  const marks = {};
  const result = {};

  return {
    /**
     * Record a named timestamp (relative to start).
     * Special names: 'queue', 'processing', 'output', 'done'
     */
    mark(name) {
      marks[name] = performance.now() - start;
    },

    /**
     * Set output byte size.
     */
    setOutputBytes(bytes) {
      result.output_bytes = bytes;
    },

    /**
     * Set frame count.
     */
    setFrameCount(count) {
      result.frame_count = count;
    },

    /**
     * Set arbitrary numeric metric.
     */
    set(key, value) {
      result[key] = value;
    },

    /**
     * Finalize and return the metrics object.
     * Calculates derived timing fields:
     *   - queue_ms: time from start to first processing mark
     *   - processing_ms: time from processing to output/done
     *   - duration_ms: total time
     *   - provider_ms: if provider mark exists, time from processing to provider
     */
    toJSON() {
      result.duration_ms = Math.round(performance.now() - start);

      if (marks.queue != null) {
        result.queue_ms = Math.round(marks.queue);
      }
      if (marks.provider != null && marks.processing != null) {
        result.provider_ms = Math.round(marks.provider - marks.processing);
      }
      if (marks.processing != null) {
        const endMs = marks.output ?? marks.done ?? (performance.now() - start);
        result.processing_ms = Math.round(endMs - marks.processing);
      }

      // Add peak memory if available
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const mem = process.memoryUsage();
        result.peak_rss_bytes = mem.rss;
        result.peak_heap_bytes = mem.heapUsed;
      }

      return result;
    },
  };
}

/**
 * Measure the execution time of an async function.
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ result: T, duration_ms: number }>}
 */
export async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, duration_ms: Math.round(performance.now() - start) };
}

/**
 * Calculate output file size in bytes.
 * @param {string} filePath
 * @returns {{ size: number, error?: string }} size in bytes, with error if inaccessible
 */
export function fileSizeBytes(filePath) {
  try {
    const stat = statSync(filePath);
    return { size: stat.size };
  } catch (e) {
    if (e.code === 'ENOENT') return { size: 0, error: 'file_not_found' };
    if (e.code === 'EACCES') return { size: 0, error: 'permission_denied' };
    if (e.code === 'ENOTDIR') return { size: 0, error: 'not_a_file' };
    return { size: 0, error: e.code || 'unknown' };
  }
}
