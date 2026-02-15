/**
 * Dashboard Bots API - LocalStack Version
 * GET /api/dashboard/bots?email=user@example.com
 * Lists all bots for a user
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

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email parameter required' });
  }

  try {
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';

    // Query by email using GSI (email-index)
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }));

    const tenants = result.Items || [];

    // Transform to dashboard format
    const bots = tenants
      .filter(t => t.status === 'active' || t.status === 'paused')
      .map(t => ({
        id: t.tenantId,
        name: t.name || 'Unnamed Bot',
        role: t.role || 'Assistant',
        template: t.template || 'blank',
        status: t.status,
        health: t.healthStatus || 'unknown',
        plan: t.plan || 'starter',
        tokensUsed: t.tokensUsed || 0,
        tokensLimit: getTokenLimit(t.plan),
        messagesToday: t.messagesToday || 0,
        lastActive: t.lastActive ? (t.lastActive * 1000) : (t.createdAt * 1000), // Convert seconds to milliseconds
        createdAt: t.createdAt,
        endpoint: t.endpoint || null,
        gatewayToken: t.gatewayToken || null
      }));

    // Aggregate stats
    const totalTokensUsed = bots.reduce((sum, b) => sum + b.tokensUsed, 0);
    const totalTokensLimit = bots.reduce((sum, b) => sum + b.tokensLimit, 0);

    // Get plan from first bot (all bots under same user have same plan)
    const plan = bots.length > 0 ? bots[0].plan : 'starter';

    return res.status(200).json({
      bots,
      plan,
      maxBots: getMaxBots(plan),
      totalTokensUsed,
      totalTokensLimit
    });

  } catch (error) {
    console.error('[Dashboard Bots] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch bots',
      details: error.message 
    });
  }
};

// Helper: Get token limit by plan
function getTokenLimit(plan) {
  const limits = {
    starter: 500000,
    professional: 2000000,
    enterprise: 10000000
  };
  return limits[plan] || limits.starter;
}

// Helper: Get max bots by plan
function getMaxBots(plan) {
  const maxes = {
    starter: 1,
    professional: 3,
    enterprise: 999
  };
  return maxes[plan] || maxes.starter;
}
