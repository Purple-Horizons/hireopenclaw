/**
 * Usage API - LocalStack Version
 * GET /api/dashboard/usage?email=user@example.com&days=30
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
    // For local dev, return mock usage data
    // TODO: Query clawops-usage table for real data
    const usageTable = process.env.DYNAMODB_USAGE_TABLE || 'clawops-usage';

    // Generate mock daily usage for the last N days
    const numDays = parseInt(days) || 30;
    const dailyUsage = [];

    for (let i = numDays - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      dailyUsage.push({
        date: dateStr,
        inputTokens: Math.floor(Math.random() * 5000) + 1000,
        outputTokens: Math.floor(Math.random() * 2000) + 500,
        apiCalls: Math.floor(Math.random() * 50) + 10,
        computeMinutes: Math.floor(Math.random() * 120) + 30
      });
    }

    return res.status(200).json({
      tenantId: tenantId || 'unknown',
      period: {
        start: dailyUsage[0].date,
        end: dailyUsage[dailyUsage.length - 1].date
      },
      dailyUsage,
      totals: {
        inputTokens: dailyUsage.reduce((sum, d) => sum + d.inputTokens, 0),
        outputTokens: dailyUsage.reduce((sum, d) => sum + d.outputTokens, 0),
        totalTokens: dailyUsage.reduce((sum, d) => sum + d.inputTokens + d.outputTokens, 0),
        apiCalls: dailyUsage.reduce((sum, d) => sum + d.apiCalls, 0),
        computeMinutes: dailyUsage.reduce((sum, d) => sum + d.computeMinutes, 0)
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
