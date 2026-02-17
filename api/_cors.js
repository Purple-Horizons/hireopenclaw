/**
 * Shared CORS helper for Vercel serverless functions.
 * Replaces wildcard Access-Control-Allow-Origin with explicit origins.
 */
const ALLOWED_ORIGINS = new Set([
  'https://hireopenclaw.com',
  'https://www.hireopenclaw.com',
  'http://localhost:3000',
  'http://localhost:18790',
  process.env.PORTAL_URL,
].filter(Boolean));

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CLI-Secret');
  }
}

module.exports = { setCors, ALLOWED_ORIGINS };
