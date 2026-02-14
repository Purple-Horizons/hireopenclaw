const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  })
});
const db = DynamoDBDocumentClient.from(client);

module.exports = async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId;
    const metric = req.query.metric || 'messages'; // messages, tokens, cost
    const period = req.query.period || '30d';
    const interval = req.query.interval || '1d'; // 1h, 1d, 1w

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    };
    const intervalMs = {
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000
    };

    const range = periodMs[period] || periodMs['30d'];
    const step = intervalMs[interval] || intervalMs['1d'];
    const fromTs = Date.now() - range;

    // Get user's bots
    const bots = await db.send(new ScanCommand({
      TableName: 'clawops-tenants',
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    }));

    // Get all usage records
    const allRecords = [];
    for (const bot of (bots.Items || [])) {
      const usage = await db.send(new QueryCommand({
        TableName: 'clawops-usage',
        KeyConditionExpression: 'tenantId = :tid AND #ts >= :from',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':tid': bot.tenantId,
          ':from': fromTs
        }
      }));
      allRecords.push(...(usage.Items || []));
    }

    // Bucket records into intervals
    const buckets = new Map();
    const now = Date.now();
    
    // Initialize all buckets
    for (let ts = fromTs; ts <= now; ts += step) {
      const bucketKey = Math.floor(ts / step) * step;
      buckets.set(bucketKey, { messages: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
    }

    // Fill buckets
    for (const record of allRecords) {
      const bucketKey = Math.floor(record.timestamp / step) * step;
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.messages += record.messageCount || 0;
        bucket.tokensIn += record.tokenIn || 0;
        bucket.tokensOut += record.tokenOut || 0;
        bucket.cost += ((record.tokenIn || 0) / 1000000) * 3 + ((record.tokenOut || 0) / 1000000) * 15;
      }
    }

    // Format output
    const data = [];
    const sortedKeys = [...buckets.keys()].sort();
    
    for (const ts of sortedKeys) {
      const bucket = buckets.get(ts);
      let value;
      
      switch (metric) {
        case 'messages': value = bucket.messages; break;
        case 'tokens': value = bucket.tokensIn + bucket.tokensOut; break;
        case 'tokensIn': value = bucket.tokensIn; break;
        case 'tokensOut': value = bucket.tokensOut; break;
        case 'cost': value = Math.round(bucket.cost * 100) / 100; break;
        default: value = bucket.messages;
      }

      data.push({
        timestamp: new Date(ts).toISOString(),
        value
      });
    }

    res.json({
      metric,
      period,
      interval,
      dataPoints: data.length,
      data
    });

  } catch (error) {
    console.error('Analytics timeseries error:', error);
    res.status(500).json({ error: 'Failed to load timeseries data' });
  }
};
