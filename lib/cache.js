/**
 * Finite cache with TTL and max capacity for sprite-gen MCP server.
 *
 * Used for:
 *   - Metadata caching (sharp image metadata)
 *   - Provider config caching
 *   - ffmpeg version check caching
 *
 * NOT used for:
 *   - API keys (never cache sensitive data)
 *   - Large binary data (images, buffers)
 */

import { LIMITS } from './limits.js';

/**
 * Create a bounded LRU-like cache with TTL expiration.
 *
 * @param {object} [options]
 * @param {number} [options.maxEntries] — max cache entries
 * @param {number} [options.defaultTtlMs] — default TTL in ms
 * @param {number} [options.maxTotalBytes] — max total size of cached values (estimated)
 * @returns {{ get, set, has, delete, clear, size, stats }}
 */
export function createCache(options = {}) {
  const maxEntries = options.maxEntries ?? LIMITS.cache.maxEntries;
  const defaultTtlMs = options.defaultTtlMs ?? LIMITS.cache.defaultTtlMs;
  const maxTotalBytes = options.maxTotalBytes ?? LIMITS.cache.maxTotalBytes;

  const store = new Map(); // key -> { value, expiresAt, size }
  let totalBytes = 0;
  let hitCount = 0;
  let missCount = 0;

  /**
   * Evict the oldest entry (first inserted).
   */
  function evictOldest() {
    const first = store.keys().next().value;
    if (first !== undefined) {
      const entry = store.get(first);
      totalBytes -= entry.size;
      store.delete(first);
    }
  }

  /**
   * Estimate the byte size of a cached value.
   */
  function estimateSize(value) {
    if (typeof value === 'string') return value.length * 2;
    if (value instanceof Buffer) return value.byteLength;
    if (typeof value === 'object') return JSON.stringify(value).length * 2;
    return 64;
  }

  return {
    /**
     * Get a cached value. Returns undefined if not found or expired.
     * @param {string} key
     * @returns {any|undefined}
     */
    get(key) {
      if (!LIMITS.cache.enabled) return undefined;

      const entry = store.get(key);
      if (!entry) {
        missCount++;
        return undefined;
      }

      if (Date.now() > entry.expiresAt) {
        totalBytes -= entry.size;
        store.delete(key);
        missCount++;
        return undefined;
      }

      // Move to end (most recently used)
      store.delete(key);
      store.set(key, entry);

      hitCount++;
      return entry.value;
    },

    /**
     * Set a cache value with optional TTL.
     * @param {string} key
     * @param {any} value
     * @param {number} [ttlMs] — override default TTL
     */
    set(key, value, ttlMs) {
      if (!LIMITS.cache.enabled) return;

      const size = estimateSize(value);

      // Remove old entry if it exists
      if (store.has(key)) {
        const old = store.get(key);
        totalBytes -= old.size;
        store.delete(key);
      }

      // Evict until we have room
      while (store.size >= maxEntries || (totalBytes + size > maxTotalBytes && store.size > 0)) {
        evictOldest();
      }

      store.set(key, {
        value,
        expiresAt: Date.now() + (ttlMs ?? defaultTtlMs),
        size,
      });
      totalBytes += size;
    },

    /**
     * Check if a key exists and is not expired.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
      if (!LIMITS.cache.enabled) return false;
      const entry = store.get(key);
      if (!entry) return false;
      if (Date.now() > entry.expiresAt) {
        totalBytes -= entry.size;
        store.delete(key);
        return false;
      }
      return true;
    },

    /**
     * Delete a specific key.
     * @param {string} key
     */
    delete(key) {
      const entry = store.get(key);
      if (entry) {
        totalBytes -= entry.size;
        store.delete(key);
      }
    },

    /**
     * Clear all cached entries.
     */
    clear() {
      store.clear();
      totalBytes = 0;
    },

    /**
     * Current number of entries.
     */
    get size() { return store.size; },

    /**
     * Cache hit/miss statistics.
     */
    stats() {
      return {
        entries: store.size,
        totalBytes,
        hitCount,
        missCount,
        hitRate: hitCount + missCount > 0 ? (hitCount / (hitCount + missCount) * 100).toFixed(1) + '%' : 'N/A',
      };
    },
  };
}

// ─── Pre-configured caches ──────────────────────────────────────────────────

/** Cache for sharp image metadata (keyed by file path + mtime) */
export const metadataCache = createCache({ maxEntries: 256, defaultTtlMs: 10 * 60 * 1000 });

/** Cache for ffmpeg/gifsicle version check results */
export const versionCache = createCache({ maxEntries: 8, defaultTtlMs: 60 * 60 * 1000 }); // 1 hour

/** Cache for provider config lookups */
export const providerConfigCache = createCache({ maxEntries: 16, defaultTtlMs: 5 * 60 * 1000 });
