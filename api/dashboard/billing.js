// Vercel Serverless Function - Dashboard Billing
// GET  /api/dashboard/billing      -> billing summary
// POST /api/dashboard/billing      -> billing portal session

export default async function handler(req, res) {
  const { setCors } = require('../_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const localSummary = require('../../api-local/dashboard/billing.js');
      return localSummary(req, res);
    }

    if (req.method === 'POST') {
      const localPortal = require('../../api-local/billing/portal.js');
      return localPortal(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Dashboard billing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
