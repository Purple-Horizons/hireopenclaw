// Vercel Serverless Function — Verify magic link token
// GET /api/auth/verify?token=xxx

import crypto from 'crypto';

export default async function handler(req, res) {
  const { setCors } = require('../_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const AUTH_SECRET = process.env.AUTH_SECRET;
  if (!AUTH_SECRET) return res.status(500).json({ error: 'Auth not configured' });

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(401).json({ error: 'Invalid token' });

    const [header, payload, signature] = parts;

    // Verify signature
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    if (signature !== expectedSig) {
      return res.status(401).json({ error: 'Invalid token signature' });
    }

    // Decode payload
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Token expired' });
    }

    // Generate a session token (longer-lived, 7 days)
    const sessHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const sessPayload = Buffer.from(JSON.stringify({
      email: decoded.email,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      iat: Math.floor(Date.now() / 1000),
      type: 'session'
    })).toString('base64url');
    const sessSig = crypto.createHmac('sha256', AUTH_SECRET)
      .update(`${sessHeader}.${sessPayload}`)
      .digest('base64url');
    const sessionToken = `${sessHeader}.${sessPayload}.${sessSig}`;

    return res.status(200).json({
      ok: true,
      email: decoded.email,
      sessionToken
    });
  } catch (error) {
    console.error('verify error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}
