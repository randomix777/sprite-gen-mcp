/**
 * Exponential backoff retry with jitter.
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      // Don't retry on non-retryable errors
      const isRetryable = err.retryable || 
                          err.code === 'PROVIDER_UNAVAILABLE' || 
                          err.code === 'PROVIDER_RATE_LIMITED' ||
                          err.message?.includes('503') ||
                          err.message?.includes('queue is full');
      
      if (!isRetryable && attempt >= maxRetries) {
        throw err;
      }
      
      if (attempt >= maxRetries) {
        break;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
      console.log(`  Retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw lastError;
}
