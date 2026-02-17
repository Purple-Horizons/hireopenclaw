/**
 * Admin API — Client Management
 * GET /api/admin/clients — List all clients with stats
 * GET /api/admin/clients/:email — Single client detail
 */

const { execSync } = require('child_process');
const { requireAdmin } = require('../auth/middleware.js');

const ENV = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'test',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'test'
};

function dynamo(cmd) {
  const full = `AWS_ENDPOINT_URL=${process.env.AWS_ENDPOINT_URL || 'http://localhost:4566'} aws dynamodb ${cmd} --region ${process.env.AWS_DEFAULT_REGION || 'us-east-1'} --output json`;
  return JSON.parse(execSync(full, { encoding: 'utf8', env: ENV }));
}

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    // Scan all tenants (acceptable for admin — small table)
    // Support pagination via cursor
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const cursor = req.query.cursor
      ? JSON.parse(Buffer.from(req.query.cursor, 'base64').toString())
      : null;
    const startKeyArg = cursor
      ? ` --exclusive-start-key '${JSON.stringify(cursor)}'`
      : '';
    const data = dynamo(`scan --table-name clawops-tenants --max-items ${limit}${startKeyArg}`);
    const items = data.Items || [];

    // Group by email
    const clientMap = {};
    for (const item of items) {
      const email = item.email?.S || 'unknown';
      const status = item.status?.S || 'unknown';
      const tenantId = item.tenantId?.S;
      const name = item.botName?.S || item.name?.S || tenantId;
      const createdAt = item.createdAt?.S || item.provisionedAt?.S;
      const health = item.healthStatus?.S || 'unknown';
      const endpoint = item.endpoint?.S;
      const port = item.port?.N;

      if (!clientMap[email]) {
        clientMap[email] = {
          email,
          bots: [],
          totalBots: 0,
          activeBots: 0,
          firstSeen: createdAt,
          lastActive: createdAt
        };
      }

      const client = clientMap[email];
      client.totalBots++;
      if (status === 'active') client.activeBots++;
      if (createdAt && (!client.firstSeen || createdAt < client.firstSeen)) client.firstSeen = createdAt;
      if (createdAt && (!client.lastActive || createdAt > client.lastActive)) client.lastActive = createdAt;

      client.bots.push({
        tenantId,
        name,
        status,
        health,
        endpoint,
        port: port ? parseInt(port) : null,
        createdAt
      });
    }

    const clients = Object.values(clientMap).sort((a, b) => {
      // Active clients first, then by last active
      if (a.activeBots !== b.activeBots) return b.activeBots - a.activeBots;
      return (b.lastActive || '').localeCompare(a.lastActive || '');
    });

    // If requesting a specific client
    const targetEmail = req.params?.email;
    if (targetEmail) {
      const client = clientMap[targetEmail];
      if (!client) return res.status(404).json({ error: 'Client not found' });
      return res.json({ ok: true, client });
    }

    // Summary stats
    const summary = {
      totalClients: clients.length,
      activeClients: clients.filter(c => c.activeBots > 0).length,
      totalBots: items.length,
      activeBots: items.filter(i => i.status?.S === 'active').length,
      terminatedBots: items.filter(i => i.status?.S === 'terminated').length
    };

    const nextCursor = data.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
      : null;

    return res.json({ ok: true, summary, clients, nextCursor });
  } catch (err) {
    console.error('[Admin] clients error:', err.message);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
};
