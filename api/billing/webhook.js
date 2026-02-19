// Vercel Serverless Function - Billing Webhook
// Delegates to shared api-local handler.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const localHandler = require('../../api-local/billing/webhook.js');
  return localHandler(req, res);
}
