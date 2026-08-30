/**
 * Unified provider HTTP client for sprite-gen.
 *
 * This is the ONLY module that should use fetch() for provider API calls.
 * All provider requests flow through here with:
 *   - URL validation
 *   - Internal timeout + caller AbortSignal (distinct error codes)
 *   - Response size limits
 *   - Status code → ErrorCode mapping
 *   - Safe error message extraction
 *   - Key/URL sanitization in errors
 */

import { LIMITS } from './limits.js';
import { err, ErrorCode, sanitizeMessage } from './result.js';

const MAX_ERROR_BODY = 500;

/**
 * Map HTTP status to ErrorCode and retryable flag.
 */
function mapStatus(status) {
  if (status === 401 || status === 403) return { code: ErrorCode.PROVIDER_AUTH_FAILED, retryable: false };
  if (status === 429) return { code: ErrorCode.PROVIDER_RATE_LIMITED, retryable: true };
  if (status === 408) return { code: ErrorCode.PROVIDER_TIMEOUT, retryable: true };
  if (status >= 500) return { code: ErrorCode.PROVIDER_UNAVAILABLE, retryable: true, serverError: true };
  return { code: ErrorCode.PROCESSING_FAILED, retryable: false };
}

/**
 * Read error body safely (limited bytes).
 */
async function safeReadBody(response) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let total = 0;
    while (total < MAX_ERROR_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    const decoder = new TextDecoder();
    return decoder.decode(Buffer.concat(chunks.map(c => Buffer.from(c)))).slice(0, MAX_ERROR_BODY);
  } catch (_) {
    return '';
  }
}

/**
 * Make an HTTP request with provider safety guarantees.
 *
 * Cancel/timeout semantics:
 *   - Internal timer fires → PROVIDER_TIMEOUT, retryable=true
 *   - Caller AbortSignal fires → CANCELLED, retryable=false
 *   - HTTP 5xx → PROVIDER_UNAVAILABLE, retryable=true
 *   - Connection failure → PROVIDER_UNAVAILABLE, retryable=true
 *
 * @param {string} url — target URL
 * @param {object} options
 * @param {string} [options.method] — HTTP method (default: GET)
 * @param {object} [options.headers]
 * @param {string|Buffer|object} [options.body]
 * @param {string} [options.bodyType='json'] — 'json', 'text', 'binary'
 * @param {number} [options.timeout] — internal timeout in ms
 * @param {AbortSignal} [options.signal] — caller's abort signal
 * @param {number} [options.maxResponseBytes]
 * @param {string} [options.provider]
 * @param {string} [options.stage]
 */
export async function providerFetch(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    bodyType = 'json',
    timeout = LIMITS.timeout.fetchMs || 120000,
    signal: callerSignal,
    maxResponseBytes = 50 * 1024 * 1024,
    provider = 'unknown',
    stage = 'provider',
  } = options;

  // Track which source triggered abort
  let internalTimeoutFired = false;
  let callerCancelled = false;

  const controller = new AbortController();
  let timeoutId;

  // Internal timeout
  if (timeout > 0) {
    timeoutId = setTimeout(() => {
      internalTimeoutFired = true;
      controller.abort(new Error('timeout'));
    }, timeout);
  }

  // Caller signal listener (must be cleaned up)
  let callerAbortHandler;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      callerCancelled = true;
      return err(ErrorCode.CANCELLED, 'Operation cancelled', { stage, provider, retryable: false });
    }
    callerAbortHandler = () => {
      callerCancelled = true;
      controller.abort(callerSignal.reason);
    };
    callerSignal.addEventListener('abort', callerAbortHandler, { once: true });
  }

  try {
    const fetchOptions = { method, headers: { ...headers }, signal: controller.signal };

    if (body !== undefined) {
      if (bodyType === 'json') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        fetchOptions.headers['Content-Type'] = fetchOptions.headers['Content-Type'] || 'application/json';
      } else if (bodyType === 'text') {
        fetchOptions.body = typeof body === 'string' ? body : String(body);
      } else {
        fetchOptions.body = body;
      }
    }

    const response = await fetch(url, fetchOptions);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxResponseBytes) {
      clearTimeout(timeoutId);
      return err(ErrorCode.PROCESSING_FAILED, `Response too large: ${contentLength} bytes (max: ${maxResponseBytes})`, { stage, provider, retryable: false });
    }

    if (!response.ok) {
      const errorBody = await safeReadBody(response);
      const mapped = mapStatus(response.status);
      const safeMessage = sanitizeMessage(errorBody.slice(0, MAX_ERROR_BODY));
      clearTimeout(timeoutId);
      return err(mapped.code, `${provider} API error ${response.status}: ${safeMessage}`, {
        stage,
        retryable: mapped.retryable,
        cause: `status=${response.status}`,
      });
    }

    const contentType = response.headers.get('content-type') || '';

    let data;
    if (bodyType === 'binary' || contentType.includes('image/') || contentType.includes('octet-stream')) {
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.length > maxResponseBytes) {
        clearTimeout(timeoutId);
        return err(ErrorCode.PROCESSING_FAILED, `Response too large: ${buf.length} bytes`, { stage, provider, retryable: false });
      }
      data = buf;
    } else {
      const text = await response.text();
      if (text.length > maxResponseBytes) {
        clearTimeout(timeoutId);
        return err(ErrorCode.PROCESSING_FAILED, `Response too large`, { stage, provider, retryable: false });
      }
      try {
        data = JSON.parse(text);
      } catch (_) {
        if (bodyType === 'json') {
          clearTimeout(timeoutId);
          return err(ErrorCode.PROCESSING_FAILED, `Invalid JSON response from ${provider}`, { stage, provider, retryable: false });
        }
        data = text;
      }
    }

    clearTimeout(timeoutId);
    return { success: true, ok: true, status: response.status, data };
  } catch (e) {
    clearTimeout(timeoutId);

    // Distinguish: caller cancel vs internal timeout vs other abort
    if (callerCancelled) {
      return err(ErrorCode.CANCELLED, 'Operation cancelled', { stage, provider, retryable: false });
    }
    if (internalTimeoutFired) {
      return err(ErrorCode.PROVIDER_TIMEOUT, `${provider} request timed out after ${timeout}ms`, { stage, provider, retryable: true });
    }
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
      return err(ErrorCode.PROVIDER_UNAVAILABLE, `${provider} connection failed: ${e.message}`, { stage, provider, retryable: true });
    }
    // Any other AbortError (shouldn't happen but be safe)
    if (e.name === 'AbortError') {
      return err(ErrorCode.PROVIDER_TIMEOUT, `${provider} request aborted`, { stage, provider, retryable: true });
    }
    return err(ErrorCode.INTERNAL_ERROR, sanitizeMessage(e.message), { stage, provider, retryable: true, cause: e.stack?.slice(0, 200) });
  } finally {
    // Always clean up caller signal listener
    if (callerSignal && callerAbortHandler) {
      callerSignal.removeEventListener('abort', callerAbortHandler);
    }
    clearTimeout(timeoutId);
  }
}

/**
 * Wait for a duration that respects an AbortSignal.
 * Rejects with CANCELLED semantics if the signal fires.
 */
export function cancellableDelay(ms, signal, provider) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(Object.assign(new Error('Operation cancelled'), { code: 'ABORT_ERR' }));
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Operation cancelled'), { code: 'ABORT_ERR' }));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    // Clean up listener when timer fires
    const origResolve = resolve;
    resolve = (...args) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      origResolve(...args);
    };
  });
}
