/**
 * Rename Bot API - LocalStack Version
 * POST /api/dashboard/rename-bot
 * Updates bot name in DynamoDB
 */


const { requireBotOwnership } = require('../auth/middleware.js');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId, newName } = req.body || {};

  if (!tenantId || !newName) {
    return res.status(400).json({ error: 'tenantId and newName are required' });
  }

  // Auth + ownership check
  const bot = await requireBotOwnership(req, res, tenantId);
  if (!bot) return;

  if (newName.trim().length === 0) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }

  console.log(`[Rename Bot] ${tenantId} → "${newName}"`);

  try {
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';

    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { tenantId },
      UpdateExpression: 'SET #name = :name, updatedAt = :now',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':name': newName.trim(),
        ':now': new Date().toISOString()
      }
    }));

    console.log(`[Rename Bot] Success: ${tenantId} renamed to "${newName}"`);

    return res.status(200).json({
      ok: true,
      tenantId,
      newName: newName.trim(),
      message: 'Bot renamed successfully'
    });

  } catch (error) {
    console.error('[Rename Bot] Error:', error);
    return res.status(500).json({
      error: 'Failed to rename bot'
    });
  }
};
