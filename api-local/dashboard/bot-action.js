/**
 * Bot Action API - LocalStack Version
 * POST /api/dashboard/bot-action
 * Actions: pause, resume, restart, terminate
 * Auth: session cookie required + bot ownership validated
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { requireBotOwnership } = require('../auth/middleware.js');
const { validateTenantId } = require('../util/validate.js');

const execFileAsync = promisify(execFile);

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

  console.log(`[Bot Action] ${action} on ${tenantId}`);

  try {
    const clawopsPath = '/Users/giannidalerta/.openclaw/workspace/repos/clawops';

    const args = action === 'terminate'
      ? [action, tenantId, '--force']
      : [action, tenantId];

    const { stdout, stderr } = await execFileAsync(
      'bin/clawops',
      args,
      {
        cwd: clawopsPath,
        timeout: 30000,
        env: {
          ...process.env,
          AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
          AWS_ACCESS_KEY_ID: 'test',
          AWS_SECRET_ACCESS_KEY: 'test'
        }
      }
    );

    console.log(`[Bot Action] Output:`, stdout);
    if (stderr) console.error(`[Bot Action] Errors:`, stderr);

    return res.status(200).json({
      ok: true,
      tenantId,
      action,
      message: `${action} completed successfully`
    });

  } catch (error) {
    console.error(`[Bot Action] ${action} failed:`, error.message);
    return res.status(500).json({
      error: `${action} failed`
    });
  }
};
