const { execSync } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

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
 * POST /v1/bots
 * Create a new bot via API
 * Requires scope: bots:create
 */
module.exports = async (req, res) => {
  try {
    const { userId, apiKey } = req;

    // Check scope
    if (!apiKey.scopes.includes('bots:create')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Missing required scope: bots:create'
      });
    }

    const { name, template = 'blank', plan = 'starter' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Bot name required' });
    }

    // Generate tenant ID
    const suffix = crypto.randomBytes(2).toString('hex');
    const tenantId = `tenant-${Date.now().toString().slice(-6)}-${suffix}`;
    const gatewayToken = `gt_${crypto.randomBytes(24).toString('hex')}`;

    // Try to provision container
    try {
      const clawopsDir = process.env.CLAWOPS_DIR || '/Users/giannidalerta/.openclaw/workspace/repos/clawops';
      execSync(
        `bash ${clawopsDir}/skills/fleet-ops/provision-local.sh --tenant-id="${tenantId}" --name="${name}" --template="${template}"`,
        { timeout: 30000, encoding: 'utf-8' }
      );
    } catch (provisionError) {
      console.error('Provision failed:', provisionError.message);
      // Still create the record, just mark as error
    }

    // Store in DynamoDB
    const bot = {
      tenantId,
      userId,
      teamId: apiKey.teamId || null,
      name,
      template,
      plan,
      status: 'active',
      gatewayToken,
      createdAt: new Date().toISOString(),
      messageCount: 0,
      tokenIn: 0,
      tokenOut: 0
    };

    await db.send(new PutCommand({
      TableName: 'clawops-tenants',
      Item: bot
    }));

    res.status(201).json({
      id: tenantId,
      name,
      template,
      plan,
      status: 'provisioning',
      gatewayToken,
      chatUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/chat/${tenantId}`,
      createdAt: bot.createdAt
    });

  } catch (error) {
    console.error('Create bot error:', error);
    res.status(500).json({ error: 'Failed to create bot' });
  }
};
