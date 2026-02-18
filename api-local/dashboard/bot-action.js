/**
 * Bot Action API - LocalStack Version
 * POST /api/dashboard/bot-action
 * Actions: pause, resume, restart, terminate
 * Auth: session cookie required + bot ownership validated
 *
 * Refactored to use Docker SDK (dockerode) instead of execFile [TASK-243]
 */

const { restartContainer, pauseContainer, unpauseContainer, stopContainer } = require('../util/docker-sdk.js');
const { requireBotOwnership } = require('../auth/middleware.js');
const { validateTenantId } = require('../util/validate.js');
const logger = require('../util/logger.js');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId, action } = req.body || {};

  if (!tenantId || !action) {
    return res.status(400).json({ error: 'tenantId and action are required' });
  }

  if (!validateTenantId(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId format' });
  }

  // Auth + ownership check
  const bot = await requireBotOwnership(req, res, tenantId);
  if (!bot) return; // Response already sent

  const validActions = ['pause', 'resume', 'restart', 'terminate'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }

  logger.info('bot-action', `${action} on ${tenantId}`);

  const containerName = `clawops-${tenantId}`;

  try {
    switch (action) {
      case 'pause':
        await pauseContainer(containerName);
        break;
      case 'resume':
        await unpauseContainer(containerName);
        break;
      case 'restart':
        await restartContainer(containerName);
        break;
      case 'terminate':
        await stopContainer(containerName);
        break;
    }

    // Update DB status to reflect the action
    const statusMap = { pause: 'paused', resume: 'active', restart: 'active', terminate: 'terminated' };
    const newStatus = statusMap[action] || 'active';
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLES.TENANTS,
        Key: { tenantId },
        UpdateExpression: 'SET #status = :status, lastActive = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': newStatus, ':now': new Date().toISOString() }
      }));
    } catch (dbErr) {
      logger.error('bot-action', 'DB status update failed', { error: dbErr.message });
    }

    return res.status(200).json({
      ok: true,
      tenantId,
      action,
      status: newStatus,
      message: `${action} completed successfully`
    });

  } catch (error) {
    logger.error('bot-action', `${action} failed`, { error: error.message });
    // Handle common Docker errors gracefully — still sync DB
    const statusMap2 = { pause: 'paused', resume: 'active', restart: 'active', terminate: 'terminated' };
    if (error.message?.includes('already paused') || error.message?.includes('not paused')) {
      const syncStatus = error.message.includes('already paused') ? 'paused' : 'active';
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLES.TENANTS,
          Key: { tenantId },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': syncStatus }
        }));
      } catch (_) {}
      const msg = error.message.includes('already paused') ? 'Bot is already paused' : 'Bot is already running';
      return res.status(200).json({ ok: true, tenantId, action, status: syncStatus, message: msg });
    }
    return res.status(500).json({
      error: `${action} failed: ${error.message}`
    });
  }
};
