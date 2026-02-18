/**
 * Admin API — Client Management
 * GET /api/admin/clients — List all clients with stats
 * GET /api/admin/clients/:email — Single client detail
 */

const { requireAdmin } = require('../auth/middleware.js');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../util/dynamodb.js');

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
    const data = await docClient.send(new ScanCommand({
      TableName: 'clawops-tenants',
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));
    const items = data.Items || [];

    // Group by email
    const clientMap = {};
    for (const item of items) {
      const email = item.email || 'unknown';
      const status = item.status || 'unknown';
      const tenantId = item.tenantId;
      const name = item.botName || item.name || tenantId;
      const createdAt = item.createdAt || item.provisionedAt;
      const health = item.healthStatus || 'unknown';
      const endpoint = item.endpoint;
      const port = item.port;

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
        port: port ? parseInt(port, 10) : null,
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
      activeBots: items.filter(i => i.status === 'active').length,
      terminatedBots: items.filter(i => i.status === 'terminated').length
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
