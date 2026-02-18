

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  try {
    const { keyId } = req.body;
    const userId = req.userEmail;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!keyId) return res.status(400).json({ error: 'keyId required' });

    // Get key and verify ownership
    const key = await db.send(new GetCommand({
      TableName: 'clawops-api-keys',
      Key: { keyId }
    }));

    if (!key.Item) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (key.Item.userId !== userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    if (key.Item.status === 'revoked') {
      return res.status(400).json({ error: 'Key already revoked' });
    }

    // Revoke
    await db.send(new UpdateCommand({
      TableName: 'clawops-api-keys',
      Key: { keyId },
      UpdateExpression: 'SET #s = :revoked, revokedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':revoked': 'revoked',
        ':now': new Date().toISOString()
      }
    }));

    res.json({
      success: true,
      message: `API key ${key.Item.name} revoked`
    });

  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
};
