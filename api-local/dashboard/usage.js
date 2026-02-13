/**
 * Usage API - LocalStack Version (REAL DATA)
 * GET /api/dashboard/usage?email=user@example.com&days=7
 * Reads from clawops-usage table
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// Configure DynamoDB client for LocalStack
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, tenantId, days } = req.query;

  if (!email && !tenantId) {
    return res.status(400).json({ error: 'Email or tenantId parameter required' });
  }

  try {
    const tenantsTable = process.env.DYNAMODB_TABLE || 'clawops-tenants';
    const usageTable = process.env.DYNAMODB_USAGE_TABLE || 'clawops-usage';

    // Get tenant IDs for this email
    let tenantIds = [];
    if (tenantId) {
      tenantIds = [tenantId];
    } else {
      const tenantsResult = await docClient.send(new QueryCommand({
        TableName: tenantsTable,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email
        }
      }));
      tenantIds = (tenantsResult.Items || []).map(t => t.tenantId);
    }

    if (tenantIds.length === 0) {
      return res.status(200).json({ dailyUsage: [], totals: { totalTokens: 0 } });
    }

    // Generate date range
    const numDays = parseInt(days) || 7;
    const dates = [];
    const today = new Date();
    for (let i = numDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split('T')[0]);
    }

    // Fetch usage for each date
    const dailyUsage = [];

    for (const dateStr of dates) {
      let dayInput = 0;
      let dayOutput = 0;

      for (const tid of tenantIds) {
        try {
          const result = await docClient.send(new QueryCommand({
            TableName: usageTable,
            KeyConditionExpression: 'tenantId = :tid AND #d = :date',
            ExpressionAttributeNames: {
              '#d': 'date'
            },
            ExpressionAttributeValues: {
              ':tid': tid,
              ':date': dateStr
            }
          }));

          if (result.Items && result.Items.length > 0) {
            const usage = result.Items[0];
            dayInput += usage.inputTokens || 0;
            dayOutput += usage.outputTokens || 0;
          }
        } catch (err) {
          console.error(`Usage query failed for ${tid} on ${dateStr}:`, err.message);
        }
      }

      dailyUsage.push({
        date: dateStr,
        inputTokens: dayInput,
        outputTokens: dayOutput
      });
    }

    return res.status(200).json({
      tenantId: tenantId || tenantIds[0],
      period: {
        start: dailyUsage[0]?.date || dates[0],
        end: dailyUsage[dailyUsage.length - 1]?.date || dates[dates.length - 1]
      },
      dailyUsage,
      totals: {
        inputTokens: dailyUsage.reduce((sum, d) => sum + d.inputTokens, 0),
        outputTokens: dailyUsage.reduce((sum, d) => sum + d.outputTokens, 0),
        totalTokens: dailyUsage.reduce((sum, d) => sum + d.inputTokens + d.outputTokens, 0)
      }
    });

  } catch (error) {
    console.error('[Dashboard Usage] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch usage',
      details: error.message 
    });
  }
};
