const { execSync } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  })
});
const db = DynamoDBDocumentClient.from(client);

/**
 * DELETE /v1/bots/:id
 * Terminate a bot via API
 * Requires scope: bots:delete
 */
module.exports = async (req, res) => {
  try {
    const { userId, apiKey } = req;
    const tenantId = req.params.id;

    if (!apiKey.scopes.includes('bots:delete')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Missing required scope: bots:delete'
      });
    }

    if (!tenantId) {
      return res.status(400).json({ error: 'Bot ID required' });
    }

    // Verify ownership
    const bot = await db.send(new GetCommand({
      TableName: 'clawops-tenants',
      Key: { tenantId }
    }));

    if (!bot.Item) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    if (bot.Item.userId !== userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    if (bot.Item.status === 'terminated') {
      return res.status(400).json({ error: 'Bot already terminated' });
    }

    // Terminate container
    try {
      const clawopsDir = process.env.CLAWOPS_DIR || '/Users/giannidalerta/.openclaw/workspace/repos/clawops';
      execSync(
        `bash ${clawopsDir}/skills/fleet-ops/terminate.sh ${tenantId} --force`,
        { timeout: 30000, encoding: 'utf-8' }
      );
    } catch (terminateError) {
      console.error('Terminate container failed:', terminateError.message);
    }

    // Update status in DynamoDB
    await db.send(new UpdateCommand({
      TableName: 'clawops-tenants',
      Key: { tenantId },
      UpdateExpression: 'SET #s = :terminated, terminatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':terminated': 'terminated',
        ':now': new Date().toISOString()
      }
    }));

    res.json({
      success: true,
      message: `Bot ${bot.Item.name} terminated`
    });

  } catch (error) {
    console.error('Delete bot error:', error);
    res.status(500).json({ error: 'Failed to delete bot' });
  }
};
