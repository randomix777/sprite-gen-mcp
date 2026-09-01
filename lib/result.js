/**
 * Unified result protocol for sprite-gen MCP server.
 *
 * Every tool returns either ok(data) or err(code, message, opts).
 * The MCP layer in server.js converts these to MCP content format.
 */

// Error codes (stable, machine-readable)
export const ErrorCode = {
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  OUTPUT_WRITE_FAILED: 'OUTPUT_WRITE_FAILED',
  CANCELLED: 'CANCELLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// Success result
export function ok(data, { artifacts = [], warnings = [], duration_ms } = {}) {
  const result = { success: true, data };
  if (artifacts.length > 0) result.artifacts = artifacts;
  if (warnings.length > 0) result.warnings = warnings;
  result.metrics = { duration_ms: duration_ms ?? 0 };
  return result;
}

// Error result
export function err(code, message, { stage, retryable = false, cause, duration_ms } = {}) {
  const error = { code, message, stage: stage || 'internal', retryable };
  if (cause) error.cause = String(cause).slice(0, 200); // truncate long causes
  return {
    success: false,
    error,
    metrics: { duration_ms: duration_ms ?? 0 },
  };
}

// Helper: create artifact entry
export function artifact(type, path, { mime_type, size_bytes } = {}) {
  const a = { type, path };
  if (mime_type) a.mime_type = mime_type;
  if (size_bytes != null) a.size_bytes = size_bytes;
  return a;
}

// Helper: safe error message — strip sensitive content
export function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return 'Internal error';
  return msg
    .replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]')  // potential tokens/keys
    .replace(/Authorization[:\s]+[^\s,]+/gi, 'Authorization: [REDACTED]')
    .replace(/key[=:]\s*[^\s,]+/gi, 'key=[REDACTED]')
    .slice(0, 500);  // cap length
}

// Timer helper
export function timer() {
  const start = Date.now();
  return () => Date.now() - start;
}

// ─── Image result unwrapper ───────────────────────────────────────────────────
// Handles both legacy (result.images) and new (result.data.images) formats.
// Returns { images, metadata } or null if no valid images found.

/**
 * Unwrap images from a generateImage result, handling both old and new formats.
 * @param {object} result — the result object from generateImage or generateImageService
 * @returns {{ images: Array<{data:string, mimeType:string, format:string}>, metadata: object } | null}
 */
export function unwrapImages(result) {
  if (!result || typeof result !== 'object') return null;
  if (!result.success) return null;

  // Try new format first: result.data.images
  if (result.data && Array.isArray(result.data.images) && result.data.images.length > 0) {
    return { images: result.data.images, metadata: result.data.metadata || {} };
  }
  // Fallback: result.images (legacy)
  if (Array.isArray(result.images) && result.images.length > 0) {
    return { images: result.images, metadata: result.metadata || {} };
  }
  return null;
}

/**
 * Get the first image from a generateImage result, or null.
 */
export function unwrapFirstImage(result) {
  const unwrapped = unwrapImages(result);
  if (!unwrapped || !unwrapped.images[0]) return null;
  return unwrapped.images[0];
}
