const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  })
});
const db = DynamoDBDocumentClient.from(client);

/**
 * GET /v1/usage
 * Get usage overview via API
 * Requires scope: usage:read
 */
module.exports = async (req, res) => {
  try {
    const { userId, apiKey } = req;

    if (!apiKey.scopes.includes('usage:read')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Missing required scope: usage:read'
      });
    }

    const from = req.query.from;
    const to = req.query.to;
    const botId = req.query.botId;

    // Calculate time range
    const fromTs = from ? new Date(from).getTime() : Date.now() - (30 * 24 * 60 * 60 * 1000);
    const toTs = to ? new Date(to).getTime() : Date.now();

    // Get user's bots
    const bots = await db.send(new QueryCommand({
      TableName: 'clawops-tenants',
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': userId }
    }));

    const botList = botId 
      ? (bots.Items || []).filter(b => b.tenantId === botId)
      : (bots.Items || []);

    // Aggregate usage
    let totalMessages = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const byBot = [];

    for (const bot of botList) {
      const usage = await db.send(new QueryCommand({
        TableName: 'clawops-usage',
        KeyConditionExpression: 'tenantId = :tid AND #ts BETWEEN :from AND :to',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':tid': bot.tenantId,
          ':from': fromTs,
          ':to': toTs
        }
      }));

      const records = usage.Items || [];
      const botMessages = records.reduce((sum, r) => sum + (r.messageCount || 0), 0);
      const botTokensIn = records.reduce((sum, r) => sum + (r.inputTokens || r.tokenIn || 0), 0);
      const botTokensOut = records.reduce((sum, r) => sum + (r.outputTokens || r.tokenOut || 0), 0);
      const botCost = (botTokensIn / 1000000) * 3 + (botTokensOut / 1000000) * 15;

      totalMessages += botMessages;
      totalTokensIn += botTokensIn;
      totalTokensOut += botTokensOut;

      byBot.push({
        botId: bot.tenantId,
        name: bot.name || bot.tenantId,
        messages: botMessages,
        tokensIn: botTokensIn,
        tokensOut: botTokensOut,
        cost: Math.round(botCost * 100) / 100
      });
    }

    const totalCost = (totalTokensIn / 1000000) * 3 + (totalTokensOut / 1000000) * 15;

    res.json({
      period: {
        from: new Date(fromTs).toISOString().split('T')[0],
        to: new Date(toTs).toISOString().split('T')[0]
      },
      usage: {
        messages: totalMessages,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cost: Math.round(totalCost * 100) / 100
      },
      byBot: byBot.sort((a, b) => b.messages - a.messages)
    });

  } catch (error) {
    console.error('Usage overview error:', error);
    res.status(500).json({ error: 'Failed to load usage data' });
  }
};
