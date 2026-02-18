const { QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.userEmail;
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
  const now = new Date();
  const startDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

  try {
    const tenantResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.TENANTS,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': { S: email },
      },
    }));

    const tenants = (tenantResult.Items || []).map(unmarshall);
    const seriesMap = new Map();

    for (const tenant of tenants) {
      const usageResult = await dynamodb.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid AND #d >= :start',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: {
          ':tid': { S: tenant.tenantId },
          ':start': { S: startDate },
        },
      }));

      for (const raw of (usageResult.Items || [])) {
        const item = unmarshall(raw);
        const day = item.date;
        if (!day) continue;
        if (!seriesMap.has(day)) {
          seriesMap.set(day, { date: day, messageCount: 0, inputTokens: 0, outputTokens: 0 });
        }
        const row = seriesMap.get(day);
        row.messageCount += Number(item.messageCount || 0);
        row.inputTokens += Number(item.inputTokens || 0);
        row.outputTokens += Number(item.outputTokens || 0);
      }
    }

    const series = [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return res.json({ ok: true, email, days, series });
  } catch (error) {
    console.error('[Analytics Timeseries] Error:', error.message);
    return res.status(500).json({ error: 'Failed to load analytics timeseries' });
  }
};
