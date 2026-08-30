/**
 * URL safety validation for sprite-gen MCP server.
 *
 * Prevents:
 *   - SSRF via file://, ftp://, data: URLs
 *   - Requests to internal/private IP ranges
 *   - Excessively long URLs
 */

import { LIMITS } from './limits.js';
import { err, ErrorCode } from './result.js';

// Well-known private/reserved IP ranges (RFC 1918, loopback, link-local, etc.)
const PRIVATE_RANGES = [
  /^127\./,                    // loopback
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^169\.254\./,               // link-local
  /^0\./,                      // current network
  /^::1$/,                     // IPv6 loopback
  /^fc:/, /^fd:/,              // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
  /^localhost$/i,              // hostname
  /\.local$/i,                 // mDNS
  /\.internal$/i,              // internal TLD
];

/**
 * Validate a URL string for safety.
 * Returns null on valid, err() on invalid.
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.allowPrivate=false] — allow localhost/private IPs (for local ComfyUI)
 * @param {string[]} [options.allowedProtocols] — override default allowed protocols
 */
export function validateUrl(urlString, options = {}) {
  if (!urlString || typeof urlString !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'URL is required', { stage: 'validation' });
  }

  if (urlString.length > LIMITS.network.maxUrlLength) {
    return err(ErrorCode.INVALID_ARGUMENT, `URL too long: ${urlString.length} chars (max: ${LIMITS.network.maxUrlLength})`, { stage: 'validation' });
  }

  // Parse URL
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    return err(ErrorCode.INVALID_ARGUMENT, `Invalid URL: ${urlString.slice(0, 100)}`, { stage: 'validation' });
  }

  const allowedProtocols = options.allowedProtocols || LIMITS.network.allowedProtocols;
  const blockedProtocols = LIMITS.network.blockedProtocols;

  // Check blocked protocols first
  if (blockedProtocols.includes(parsed.protocol)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Blocked protocol: ${parsed.protocol}`, { stage: 'validation' });
  }

  // Check allowed protocols
  if (!allowedProtocols.includes(parsed.protocol)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Unsupported protocol: ${parsed.protocol}. Allowed: ${allowedProtocols.join(', ')}`, { stage: 'validation' });
  }

  // SSRF protection — block private/internal IPs unless explicitly allowed
  if (!options.allowPrivate) {
    const hostname = parsed.hostname;
    for (const range of PRIVATE_RANGES) {
      if (range.test(hostname)) {
        return err(ErrorCode.INVALID_ARGUMENT, `Requests to internal/private addresses are not allowed: ${hostname}`, { stage: 'validation' });
      }
    }
  }

  return null; // valid
}

/**
 * Validate a ComfyUI base URL.
 * ComfyUI is always local — only allow http://127.0.0.1 or http://localhost.
 * @param {string} baseUrl
 */
export function validateComfyUrl(baseUrl) {
  if (!baseUrl) return null; // will use default

  // Basic URL format check (allow private IPs since ComfyUI is local)
  const basicErr = validateUrl(baseUrl, {
    allowedProtocols: ['http:', 'https:'],
    allowPrivate: true,
  });
  if (basicErr) return basicErr;

  // Enforce localhost-only
  try {
    const parsed = new URL(baseUrl);
    const allowedHosts = ['127.0.0.1', 'localhost', '::1'];
    if (!allowedHosts.includes(parsed.hostname)) {
      return err(ErrorCode.INVALID_ARGUMENT, `ComfyUI must be on localhost, got: ${parsed.hostname}`, { stage: 'validation' });
    }
  } catch (_) {
    return err(ErrorCode.INVALID_ARGUMENT, `Invalid ComfyUI URL: ${baseUrl.slice(0, 100)}`, { stage: 'validation' });
  }

  return null;
}

/**
 * Sanitize a URL for error messages (strip query params, fragments, auth info).
 * @param {string} urlString
 * @returns {string}
 */
export function sanitizeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    // Remove auth, password, search params, hash
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '[invalid-url]';
  }
}
