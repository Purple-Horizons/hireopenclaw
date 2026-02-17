const crypto = require('crypto');

function generateCsrfToken(sessionToken) {
  return crypto.createHmac('sha256', process.env.CSRF_SECRET || 'dev-csrf-secret')
    .update(sessionToken)
    .digest('hex');
}

function validateCsrf(req, res, next) {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Skip for webhooks and public endpoints
  if (req.path.includes('/webhook') || req.path.includes('/magic-link') || req.path.includes('/auth/session')) return next();
  // In test/development mode, skip CSRF
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return next();
  
  const token = req.headers['x-csrf-token'];
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  if (!match) return next(); // No session = no CSRF needed (auth will reject)
  
  const expected = generateCsrfToken(match[1]);
  if (token !== expected) {
    return res.status(403).json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
  }
  next();
}

module.exports = { validateCsrf, generateCsrfToken };
