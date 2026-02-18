// Vercel Serverless Function - dashboard bots
// Delegates to hardened api-local handler.

export default async function handler(req, res) {
  const { setCors } = require('../_cors');
  setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const localHandler = require('../../api-local/dashboard/bots.js');
  return localHandler(req, res);
}
