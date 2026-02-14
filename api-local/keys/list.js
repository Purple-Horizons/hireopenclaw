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

module.exports = async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await db.send(new QueryCommand({
      TableName: 'clawops-api-keys',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    }));

    const keys = (result.Items || [])
      .filter(k => k.status === 'active')
      .map(k => ({
        keyId: k.keyId,
        publicKey: k.publicKey,
        name: k.name,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        status: k.status,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    res.json({ keys, total: keys.length });

  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
};
