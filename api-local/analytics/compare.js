const { QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.userEmail;
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const currentDays = Math.min(Math.max(parseInt(req.query.currentDays, 10) || 7, 1), 90);
  const previousDays = Math.min(Math.max(parseInt(req.query.previousDays, 10) || currentDays, 1), 90);

  try {
    const tenantResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.TENANTS,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': { S: email } },
    }));
    const tenantIds = (tenantResult.Items || []).map((item) => unmarshall(item).tenantId).filter(Boolean);

    const now = new Date();
    const currentStart = new Date(now.getTime() - (currentDays * 24 * 60 * 60 * 1000));
    const previousEnd = currentStart;
    const previousStart = new Date(previousEnd.getTime() - (previousDays * 24 * 60 * 60 * 1000));

    const current = await aggregateWindow(tenantIds, currentStart, now);
    const previous = await aggregateWindow(tenantIds, previousStart, previousEnd);

    return res.json({
      ok: true,
      email,
      windows: {
        current: { days: currentDays, ...current },
        previous: { days: previousDays, ...previous },
      },
      delta: {
        messages: current.messages - previous.messages,
        inputTokens: current.inputTokens - previous.inputTokens,
        outputTokens: current.outputTokens - previous.outputTokens,
      },
    });
  } catch (error) {
    console.error('[Analytics Compare] Error:', error.message);
    return res.status(500).json({ error: 'Failed to load analytics comparison' });
  }
};

async function aggregateWindow(tenantIds, start, end) {
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const totals = { messages: 0, inputTokens: 0, outputTokens: 0 };

  for (const tenantId of tenantIds) {
    const usageResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.USAGE,
      KeyConditionExpression: 'tenantId = :tid AND #d BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: {
        ':tid': { S: tenantId },
        ':start': { S: startDate },
        ':end': { S: endDate },
      },
    }));

    for (const raw of (usageResult.Items || [])) {
      const item = unmarshall(raw);
      totals.messages += Number(item.messageCount || 0);
      totals.inputTokens += Number(item.inputTokens || 0);
      totals.outputTokens += Number(item.outputTokens || 0);
    }
  }

  return totals;
}
