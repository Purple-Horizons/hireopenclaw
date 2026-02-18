

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  try {
    const userId = req.userEmail;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const cursor = parseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }

    const result = await db.send(new QueryCommand({
      TableName: 'clawops-api-keys',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      Limit: limit,
      ...(cursor && { ExclusiveStartKey: cursor })
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
      .sort((a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt));

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    res.json({ items: keys, total: keys.length, nextCursor });

  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
};

function toEpochMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCursor(raw) {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    const decoded = Buffer.from(raw, 'base64').toString();
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
