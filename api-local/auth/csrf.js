/**
 * CSRF Protection
 * Generates and validates CSRF tokens for state-changing requests
 */

const crypto = require('crypto');
const tokenStore = require('./token-store.js');

function generateCsrfToken(sessionToken) {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const session = tokenStore.get(sessionToken);
  if (session) {
    session.csrfToken = csrfToken;
    tokenStore.set(sessionToken, session);
  }
  return csrfToken;
}

function validateCsrf(req, res, next) {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Skip for API key auth (machine-to-machine)
  if (req.headers['x-api-key']) return next();

  // Skip for webhook endpoints
  if (req.path.includes('/webhook')) return next();

  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  const sessionToken = match ? match[1] : null;
  if (!sessionToken) return next(); // No session = no CSRF needed (will fail auth anyway)

  const session = tokenStore.get(sessionToken);
  if (!session || !session.csrfToken) return next(); // No CSRF token set yet

  const csrfHeader = req.headers['x-csrf-token'];
  if (csrfHeader !== session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

module.exports = { generateCsrfToken, validateCsrf };
