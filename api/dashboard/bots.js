// Vercel Serverless Function - List client's bots
// GET /api/dashboard/bots?email=client@company.com

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ error: 'Email parameter required' });
    }

    // TODO: Authenticate request (verify magic link token or session)
    // TODO: Query DynamoDB for tenants matching this email
    
    // For now, return mock data
    // In production, this queries:
    //   aws dynamodb query --table-name clawops-tenants --index-name email-index --key-condition-expression "email = :e"
    
    const mockBots = [
      {
        id: 'tenant-001',
        name: 'Morgan',
        role: 'Content Creator',
        template: 'marketing',
        status: 'active',
        health: 'healthy',
        plan: 'team',
        tokensUsed: 523000,
        tokensLimit: 2000000,
        messagestoday: 84,
        lastActive: new Date(Date.now() - 2 * 60000).toISOString(),
        createdAt: '2026-02-01T00:00:00Z'
      },
      {
        id: 'tenant-002',
        name: 'Alex',
        role: 'Sales Development',
        template: 'sales',
        status: 'active',
        health: 'healthy',
        plan: 'team',
        tokensUsed: 319000,
        tokensLimit: 2000000,
        messagesToday: 43,
        lastActive: new Date(Date.now() - 5 * 60000).toISOString(),
        createdAt: '2026-02-05T00:00:00Z'
      }
    ];

    return res.status(200).json({
      bots: mockBots,
      plan: 'team',
      maxBots: 3,
      totalTokensUsed: 842000,
      totalTokensLimit: 2000000
    });

  } catch (error) {
    console.error('Dashboard bots error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
