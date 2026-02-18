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

    return res.status(200).json({
      ok: true,
      tenantId,
      action,
      message: `${action} completed successfully`
    });

  } catch (error) {
    logger.error('bot-action', `${action} failed`, { error: error.message });
    // Handle common Docker errors gracefully
    if (error.message?.includes('already paused')) {
      return res.status(200).json({ ok: true, tenantId, action, message: 'Bot is already paused' });
    }
    if (error.message?.includes('not paused')) {
      return res.status(200).json({ ok: true, tenantId, action, message: 'Bot is already running' });
    }
    return res.status(500).json({
      error: `${action} failed: ${error.message}`
    });
  }
};
