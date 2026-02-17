// Vercel Serverless Function - Usage metrics for a tenant
// GET /api/dashboard/usage?tenantId=tenant-001

export default async function handler(req, res) {
  const { setCors } = require('../_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId parameter required' });
    }

    // TODO: Authenticate + verify tenant belongs to user
    // TODO: Query DynamoDB clawops-usage table for this tenant's metrics

    // Mock data — 30-day usage history
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      days.push({
        date: date.toISOString().split('T')[0],
        tokens: Math.floor(Math.random() * 50000) + 10000,
        messages: Math.floor(Math.random() * 100) + 20
      });
    }

    return res.status(200).json({
      tenantId,
      period: '30d',
      daily: days,
      totals: {
        tokens: days.reduce((sum, d) => sum + d.tokens, 0),
        messages: days.reduce((sum, d) => sum + d.messages, 0)
      }
    });

  } catch (error) {
    console.error('Dashboard usage error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
