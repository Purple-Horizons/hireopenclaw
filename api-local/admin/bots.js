/**
 * Admin API — Bot Management
 * POST /api/admin/bots/:tenantId/restart — Restart a bot container
 * GET /api/admin/bots/:tenantId/logs — Get bot container logs
 * GET /api/admin/bots/:tenantId/config — Get bot's openclaw.json
 */

const { restartContainer, getContainerLogs, inspectContainer, getContainerConfig, discoverConfigPaths } = require('../util/docker-sdk.js');
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
        const basePaths = [
          '/app/.openclaw/openclaw.json',
          '/app/openclaw.json',
          '/app/.openclaw/config/openclaw.json',
        ];
        let candidatePaths = [...basePaths];

        // Probe for non-standard container layouts before failing.
        try {
          const discovered = await discoverConfigPaths(containerName);
          for (const path of discovered) {
            if (!candidatePaths.includes(path)) candidatePaths.push(path);
          }
        } catch (err) {
          logger.warn('admin', 'Config discovery probe failed', { tenantId, error: err.message });
        }

        let configRaw = null;
        let foundPath = null;
        let lastErr = null;

        for (const path of candidatePaths) {
          try {
            const text = await getContainerConfig(containerName, path);
            if (typeof text === 'string' && text.trim().length > 0) {
              configRaw = text;
              foundPath = path;
              break;
            }
          } catch (err) {
            lastErr = err;
          }
        }

        if (!configRaw) {
          return res.status(404).json({
            error: `Config file not found in container (${candidatePaths.join(', ')})`,
            detail: lastErr?.message || null,
          });
        }

        let parsed = null;
        try {
          parsed = JSON.parse(configRaw);
        } catch {
          // Non-JSON config (or malformed JSON) should still be inspectable by admin.
          parsed = null;
        }

        return res.json({ ok: true, path: foundPath, config: parsed, raw: parsed ? undefined : configRaw });
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
