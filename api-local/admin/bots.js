/**
 * Admin API — Bot Management
 * POST /api/admin/bots/:tenantId/restart — Restart a bot container
 * GET /api/admin/bots/:tenantId/logs — Get bot container logs
 * GET /api/admin/bots/:tenantId/config — Get bot's openclaw.json
 */

const { dockerExec } = require('../util/docker.js');
const logger = require('../util/logger.js');
const { requireAdmin } = require('../auth/middleware.js');
const { validateTenantId, validateLines } = require('../util/validate.js');

// Named constants (TASK-306)
const RESTART_TIMEOUT_MS = 30000;
const LOGS_TIMEOUT_MS = 10000;
const CONFIG_TIMEOUT_MS = 5000;
const INSPECT_TIMEOUT_MS = 5000;

module.exports = async (req, res) => {
  const admin = requireAdmin(req, res);
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
        await dockerExec(['restart', containerName], { timeout: RESTART_TIMEOUT_MS });
        return res.json({ ok: true, message: `Restarted ${containerName}` });
      }

      case 'logs': {
        const lines = validateLines(req.query.lines);
        const logs = await dockerExec(['logs', containerName, '--tail', String(lines)], {
          timeout: LOGS_TIMEOUT_MS
        });
        return res.json({ ok: true, logs: logs.split('\n') });
      }

      case 'config': {
        const config = await dockerExec(['exec', containerName, 'cat', '/app/.openclaw/openclaw.json'], {
          timeout: CONFIG_TIMEOUT_MS
        });
        return res.json({ ok: true, config: JSON.parse(config) });
      }

      case 'info': {
        const inspect = await dockerExec(['inspect', containerName], {
          timeout: INSPECT_TIMEOUT_MS
        });
        const data = JSON.parse(inspect)[0];
        return res.json({
          ok: true,
          container: {
            id: data.Id?.slice(0, 12),
            status: data.State?.Status,
            health: data.State?.Health?.Status,
            started: data.State?.StartedAt,
            image: data.Config?.Image,
            ports: data.NetworkSettings?.Ports
          }
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    logger.error('admin', 'Bot action failed', { tenantId, error: err.message });
    return res.status(500).json({ error: 'Bot operation failed' });
  }
};
