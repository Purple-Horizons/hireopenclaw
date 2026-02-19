// Vercel Serverless Function - Stripe Checkout
// Delegates to shared local billing handler for consistent plan behavior.

export default async function handler(req, res) {
  const { setCors } = require('./_cors');
  setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const localHandler = require('../api-local/billing/checkout.js');
  return localHandler(req, res);
}
