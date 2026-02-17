const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_ATTEMPTS = 5;

function rateLimit(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return true;
  }
  record.count++;
  if (record.count > MAX_ATTEMPTS) return false;
  return true;
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

module.exports = { rateLimit, _reset, MAX_ATTEMPTS, WINDOW_MS };
