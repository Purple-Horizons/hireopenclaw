// Vercel Serverless Function - Stripe webhook
// Delegates to hardened api-local billing webhook handler.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const localHandler = require('../../api-local/billing/webhook.js');
  return localHandler(req, res);
}
