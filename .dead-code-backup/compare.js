const { execSync } = require('child_process');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');


module.exports = async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId;
    const period = req.query.period || '7d';

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    const range = periodMs[period] || periodMs['7d'];
    const fromTs = Date.now() - range;

    // Get user's bots
    const bots = await db.send(new QueryCommand({
      TableName: 'clawops-tenants',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    }));

    const comparisons = [];

    for (const bot of (bots.Items || [])) {
      const tenantId = bot.tenantId;

      // Get usage
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
      const messages = records.reduce((sum, r) => sum + (r.messageCount || 0), 0);
      const tokensIn = records.reduce((sum, r) => sum + (r.tokenIn || 0), 0);
      const tokensOut = records.reduce((sum, r) => sum + (r.tokenOut || 0), 0);
      const cost = (tokensIn / 1000000) * 3 + (tokensOut / 1000000) * 15;

      // Try to get container stats (Docker)
      let uptime = null;
      let memoryMb = null;
      let cpuPercent = null;
      const containerName = `clawops-${tenantId}`;

      try {
        const stats = execSync(
          `docker stats ${containerName} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}" 2>/dev/null`,
          { timeout: 5000, encoding: 'utf-8' }
        ).trim();

        if (stats) {
          const [cpu, mem] = stats.split('|');
          cpuPercent = parseFloat(cpu) || 0;
          const memMatch = mem?.match(/([\d.]+)MiB/);
          memoryMb = memMatch ? parseFloat(memMatch[1]) : null;
        }
      } catch (err) {
        console.error('[Analytics] Container stats fetch failed:', err.message);
      }

      // Calculate uptime from creation
      const createdAt = bot.createdAt ? new Date(bot.createdAt).getTime() : null;
      if (createdAt) {
        const uptimeMs = Date.now() - createdAt;
        const uptimeDays = Math.floor(uptimeMs / (24 * 60 * 60 * 1000));
        const uptimeHours = Math.floor((uptimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        uptime = `${uptimeDays}d ${uptimeHours}h`;
      }

      comparisons.push({
        botId: tenantId,
        name: bot.name || tenantId,
        status: bot.status || 'unknown',
        template: bot.template || 'blank',
        messages,
        tokensIn,
        tokensOut,
        cost: Math.round(cost * 100) / 100,
        avgCostPerMessage: messages > 0 ? Math.round((cost / messages) * 10000) / 10000 : 0,
        uptime,
        memoryMb,
        cpuPercent
      });
    }

    // Sort by messages (most active first)
    comparisons.sort((a, b) => b.messages - a.messages);

    res.json({
      period,
      totalBots: comparisons.length,
      bots: comparisons
    });

  } catch (error) {
    console.error('Analytics compare error:', error);
    res.status(500).json({ error: 'Failed to compare bots' });
  }
};
