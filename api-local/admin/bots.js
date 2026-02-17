/**
 * Admin API — Bot Management
 * POST /api/admin/bots/:tenantId/restart — Restart a bot container
 * GET /api/admin/bots/:tenantId/logs — Get bot container logs
 * GET /api/admin/bots/:tenantId/config — Get bot's openclaw.json
 */

const { restartContainer, getContainerLogs, inspectContainer, getContainerConfig } = require('../util/docker-sdk.js');
const logger = require('../util/logger.js');
const { requireAdmin } = require('../auth/middleware.js');
const { validateTenantId, validateLines } = require('../util/validate.js');

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { tenantId } = req.params;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  const containerName = `clawops-${tenantId}`;
  const action = req.query.action || (req.method === 'POST' ? 'restart' : 'info');

  try {
    switch (action) {
      case 'restart': {
        logger.info('admin', `Restarting container`, { admin, container: containerName });
        await restartContainer(containerName);
        return res.json({ ok: true, message: `Restarted ${containerName}` });
      }

      case 'logs': {
        const lines = validateLines(req.query.lines);
        const logs = await getContainerLogs(containerName, lines);
        return res.json({ ok: true, logs });
      }

      case 'config': {
        const configRaw = await getContainerConfig(containerName, '/app/.openclaw/openclaw.json');
        return res.json({ ok: true, config: JSON.parse(configRaw) });
      }

      case 'info': {
        const info = await inspectContainer(containerName);
        return res.json({ ok: true, container: info });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    logger.error('admin', 'Bot action failed', { tenantId, error: err.message });
    return res.status(500).json({ error: 'Bot operation failed' });
  }
};
