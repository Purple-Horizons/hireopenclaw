// Vercel Serverless Function - dashboard usage
// Delegates to hardened api-local handler.

export default async function handler(req, res) {
  const { setCors } = require('../_cors');
  setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Vercel route is query-driven. Map tenantId query to params for local handler.
  if (!req.params) req.params = {};
  if (req.query?.tenantId) req.params.tenantId = req.query.tenantId;

  const localHandler = require('../../api-local/dashboard/usage.js');
  return localHandler(req, res);
}
