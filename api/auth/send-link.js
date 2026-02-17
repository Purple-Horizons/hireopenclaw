// Vercel Serverless Function — Send magic link email
// POST /api/auth/send-link  { email: "user@company.com" }

import crypto from 'crypto';

export default async function handler(req, res) {
  const { setCors } = require('../_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const AUTH_SECRET = process.env.AUTH_SECRET;
  if (!AUTH_SECRET) {
    console.error('AUTH_SECRET not configured');
    return res.status(500).json({ error: 'Auth not configured' });
  }

  try {
    // Create a simple JWT-like token: base64(header).base64(payload).signature
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      email,
      exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 min expiry
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID()
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', AUTH_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const token = `${header}.${payload}.${signature}`;

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://hireopenclaw.com';
    const magicLink = `${baseUrl}/dashboard?token=${token}`;

    // Send email via Resend
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'HireOpenClaw <no-reply@hireopenclaw.com>',
          to: email,
          subject: 'Your sign-in link',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
              <h2 style="color:#0a0a0a;">Sign in to HireOpenClaw</h2>
              <p style="color:#555;">Click the link below to access your dashboard. This link expires in 15 minutes.</p>
              <a href="${magicLink}" style="display:inline-block;background:#ff6b35;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">Sign In →</a>
              <p style="color:#999;font-size:12px;">If you didn't request this, ignore this email.</p>
            </div>
          `
        })
      });
      if (!emailRes.ok) {
        console.error('Resend error:', await emailRes.text());
        return res.status(500).json({ error: 'Failed to send email' });
      }
    } else {
      // No Resend key — log for development
      console.log(`[DEV] Magic link for ${email}: ${magicLink}`);
    }

    return res.status(200).json({ ok: true, message: 'Magic link sent. Check your email.' });
  } catch (error) {
    console.error('send-link error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
