const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_ATTEMPTS = 5;

/**
 * Check rate limit for a key.
 * @returns {{ allowed: boolean, remaining: number, resetTime: number }}
 */
function rateLimit(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, resetTime: now + WINDOW_MS };
  }
  record.count++;
  const remaining = Math.max(0, MAX_ATTEMPTS - record.count);
  const resetTime = record.start + WINDOW_MS;
  if (record.count > MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0, resetTime };
  }
  return { allowed: true, remaining, resetTime };
}

/**
 * Set rate limit headers on a response object.
 */
function setRateLimitHeaders(res, info) {
  res.setHeader('X-RateLimit-Limit', MAX_ATTEMPTS);
  res.setHeader('X-RateLimit-Remaining', info.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(info.resetTime / 1000));
}

// Cleanup old entries periodically
const _cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now - record.start > WINDOW_MS) attempts.delete(key);
  }
}, 60000);
if (_cleanup.unref) _cleanup.unref();

// For testing
function _reset() { attempts.clear(); }

module.exports = { rateLimit, setRateLimitHeaders, _reset, MAX_ATTEMPTS, WINDOW_MS };
