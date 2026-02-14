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
    const page = parseInt(req.query.page) || 1;
    const perPage = Math.min(parseInt(req.query.perPage) || 20, 100);

    // Query bots
    const result = await db.send(new QueryCommand({
      TableName: 'clawops-bots',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }));

    const bots = result.Items || [];

    // Filter by team if teamId exists
    const filtered = teamId 
      ? bots.filter(b => b.teamId === teamId)
      : bots;

    // Sort by creation date (newest first)
    filtered.sort((a, b) => b.createdAt - a.createdAt);

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
      createdAt: new Date(bot.createdAt).toISOString(),
      usage: {
        messages: bot.messageCount || 0,
        tokensIn: bot.tokenIn || 0,
        tokensOut: bot.tokenOut || 0
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
