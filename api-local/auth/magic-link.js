/**
 * Magic Link Authentication API
 * POST /api/auth/magic-link - Generate and send magic link
 * GET /api/auth/verify - Verify magic link token
 */

const crypto = require('crypto');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

async function emailExists(email) {
  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: 'clawops-tenants',
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': { S: email } }
    }));
    return result.Items && result.Items.length > 0;
  } catch (err) {
    console.error('[Magic Link] DB check failed:', err.message);
    return false;
  }
}

// Shared token store
const tokenStore = require('./token-store.js');

// Token expiry: 15 minutes
const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

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

module.exports = async (req, res) => {
  const { action } = req.query;
  
  // Generate magic link
  if (req.method === 'POST' || action === 'generate') {
    const { email } = req.body || req.query;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
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
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    return res.status(200).json({
      ok: true,
      message: 'If an account exists with that email, a login link has been sent.',
      expiresIn: '15 minutes',
      ...(isDev && { token, magicLink })
    });
  }
  
  // Verify magic link token
  if (req.method === 'GET' && action === 'verify') {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const tokenData = tokenStore.get(token);
    
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
    const sessionExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    
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
