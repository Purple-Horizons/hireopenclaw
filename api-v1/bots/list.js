const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  })
});

const db = DynamoDBDocumentClient.from(client);

/**
 * GET /v1/bots
 * List all bots for the authenticated user/team
 * 
 * Rate limited via middleware
 * Requires scope: bots:read
 */
module.exports = async (req, res) => {
  try {
    const { userId, teamId, apiKey } = req;

    // Check scope
    if (!apiKey.scopes.includes('bots:read')) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Missing required scope: bots:read'
      });
    }

    // Pagination
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 20, 1), 100);

    // Query bots from canonical tenants table by owner identity
    const result = await db.send(new QueryCommand({
      TableName: 'clawops-tenants',
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': userId
      }
    }));

    const bots = result.Items || [];

    // Filter by team if teamId exists
    const filtered = teamId 
      ? bots.filter(b => b.teamId === teamId)
      : bots;

    // Sort by creation date (newest first)
    filtered.sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt)).reverse();

    // Paginate
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paginated = filtered.slice(start, end);

    // Format response
    const formatted = paginated.map(bot => ({
      id: bot.tenantId,
      name: bot.name,
      status: bot.status,
      template: bot.template,
      plan: bot.plan,
      createdAt: toIso(bot.createdAt),
      usage: {
        messages: bot.messageCount || 0,
        tokensIn: bot.inputTokens || bot.tokenIn || 0,
        tokensOut: bot.outputTokens || bot.tokenOut || 0
      },
      chatUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/chat/${bot.tenantId}`
    }));

    res.json({
      bots: formatted,
      total: filtered.length,
      page,
      perPage,
      totalPages: Math.ceil(filtered.length / perPage)
    });

  } catch (error) {
    console.error('List bots error:', error);
    res.status(500).json({ error: 'Failed to list bots' });
  }
};

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value > 1_000_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toIso(value) {
  const ts = toTimestamp(value);
  return ts ? new Date(ts).toISOString() : null;
}
