const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId;
    const period = req.query.period || '30d';

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Calculate time range
    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    };
    const range = periodMs[period] || periodMs['30d'];
    const fromTs = Date.now() - range;

    // Get user's bots
    const bots = await db.send(new QueryCommand({
      TableName: 'clawops-tenants',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    }));

    const botList = bots.Items || [];
    
    // Aggregate usage across all bots
    let totalMessages = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;
    const botUsage = [];

    for (const bot of botList) {
      const tenantId = bot.tenantId;
      
      // Query usage table
      const usage = await db.send(new QueryCommand({
        TableName: 'clawops-usage',
        KeyConditionExpression: 'tenantId = :tid AND #ts >= :from',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':from': fromTs
        }
      }));

      const records = usage.Items || [];
      const botMessages = records.reduce((sum, r) => sum + (r.messageCount || 0), 0);
      const botTokensIn = records.reduce((sum, r) => sum + (r.tokenIn || 0), 0);
      const botTokensOut = records.reduce((sum, r) => sum + (r.tokenOut || 0), 0);
      
      // Estimate cost ($0.003/1K input, $0.015/1K output for Claude)
      const botCost = (botTokensIn / 1000000) * 3 + (botTokensOut / 1000000) * 15;

      totalMessages += botMessages;
      totalTokensIn += botTokensIn;
      totalTokensOut += botTokensOut;
      totalCost += botCost;

      if (botMessages > 0) {
        botUsage.push({
          botId: tenantId,
          name: bot.name || tenantId,
          messages: botMessages,
          tokensIn: botTokensIn,
          tokensOut: botTokensOut,
          cost: Math.round(botCost * 100) / 100
        });
      }
    }

    // Sort by usage (highest first)
    botUsage.sort((a, b) => b.messages - a.messages);

    res.json({
      period,
      summary: {
        totalBots: botList.length,
        activeBots: botUsage.length,
        messages: totalMessages,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cost: Math.round(totalCost * 100) / 100,
        avgCostPerMessage: totalMessages > 0 
          ? Math.round((totalCost / totalMessages) * 10000) / 10000 
          : 0
      },
      byBot: botUsage.slice(0, Math.min(parseInt(req.query.limit) || 20, 100))
    });

  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
};
