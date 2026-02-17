/**
 * Magic Link Authentication API
 * POST /api/auth/magic-link - Generate and send magic link
 * GET /api/auth/verify - Verify magic link token
 */

const crypto = require('crypto');
const { QueryCommand } = require('@aws-sdk/client-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { ERROR_CODES, apiError } = require('../util/error-codes.js');

const { userExists } = require('./team-plan.js');

async function emailExists(email) {
  // TASK-300: Check teams table (user/account level), not tenants (per-bot)
  try {
    return await userExists(email);
  } catch (err) {
    console.error('[Magic Link] DB check failed:', err.message);
    return false;
  }
}

// Shared token store
const tokenStore = require('./token-store.js');

// Named constants (TASK-306)
const TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createMagicLink(email) {
  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  
  tokenStore.set(token, {
    email,
    expiresAt,
    used: false
  });
  
  // Clean up expired tokens
  for (const [key, value] of tokenStore.entries()) {
    if (value.expiresAt < Date.now()) {
      tokenStore.delete(key);
    }
  }
  
  const magicLink = `http://localhost:3000/auth/verify?token=${token}`;
  return { token, magicLink, expiresAt };
}

async function sendMagicLinkEmail(email, magicLink) {
  // TODO: Integrate with Resend or SES
  // For now, just log it
  console.log(`\n🔗 Magic Link for ${email}:`);
  console.log(`   ${magicLink}`);
  console.log(`   Expires in 15 minutes\n`);
  
  // In production, send actual email:
  // await resend.emails.send({
  //   from: 'ClawOps <noreply@hireopenclaw.com>',
  //   to: email,
  //   subject: 'Your ClawOps login link',
  //   html: `<p>Click here to log in: <a href="${magicLink}">${magicLink}</a></p>`
  // });
  
  return true;
}

const { rateLimit, setRateLimitHeaders } = require('./rate-limit.js');

module.exports = async (req, res) => {
  const { action } = req.query;
  
  // Generate magic link
  if (req.method === 'POST' || action === 'generate') {
    const { email } = req.body || req.query;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    // Rate limit by IP + email
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const rateLimitKey = `magic:${ip}:${email.toLowerCase()}`;
    const rlResult = rateLimit(rateLimitKey);
    setRateLimitHeaders(res, rlResult);
    if (!rlResult.allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    
    console.log(`[Magic Link] Generating for ${email}`);
    
    // Check if email exists in our tenant database or is an admin
    const { isAdmin } = require('./middleware.js');
    const exists = await emailExists(email) || isAdmin(email);
    
    if (!exists) {
      console.log(`[Magic Link] ⚠️ No account found for ${email}`);
      // Same response whether account exists or not (prevent email enumeration)
      return res.status(200).json({
        ok: true,
        message: 'If an account exists with that email, a login link has been sent.',
        expiresIn: '15 minutes'
      });
    }

    const { token, magicLink, expiresAt } = createMagicLink(email);
    
    // Send email (or log for local dev)
    await sendMagicLinkEmail(email, magicLink);
    
    // In dev mode, return token for CLI usage. In production, omit it.
    const showDevTokens = process.env.NODE_ENV === 'development' && process.env.MAGIC_LINK_DEV_TOKENS === 'true';
    return res.status(200).json({
      ok: true,
      message: 'If an account exists with that email, a login link has been sent.',
      expiresIn: '15 minutes',
      ...(showDevTokens && { token, magicLink })
    });
  }
  
  // Verify magic link token
  if (req.method === 'GET' && action === 'verify') {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Rate limit verify by IP
    const verifyIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const verifyRl = rateLimit(`verify:${verifyIp}`);
    setRateLimitHeaders(res, verifyRl);
    if (!verifyRl.allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    
    const tokenData = await tokenStore.get(token);
    
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (tokenData.used) {
      return res.status(401).json({ error: 'Token already used' });
    }
    
    if (tokenData.expiresAt < Date.now()) {
      tokenStore.delete(token);
      return res.status(401).json({ error: 'Token expired' });
    }
    
    // Mark token as used
    tokenData.used = true;
    tokenStore.set(token, tokenData);
    
    console.log(`[Magic Link] Verified for ${tokenData.email}`);
    
    // Create session token (30 days)
    const sessionToken = generateToken();
    const sessionExpiresAt = Date.now() + SESSION_EXPIRY_MS;
    
    tokenStore.set(sessionToken, {
      email: tokenData.email,
      expiresAt: sessionExpiresAt,
      type: 'session'
    });
    
    return res.status(200).json({
      ok: true,
      email: tokenData.email,
      sessionToken,
      expiresAt: sessionExpiresAt
    });
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};
