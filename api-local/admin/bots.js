/**
 * Admin API — Bot Management
 * POST /api/admin/bots/:tenantId/restart — Restart a bot container
 * GET /api/admin/bots/:tenantId/logs — Get bot container logs
 * GET /api/admin/bots/:tenantId/config — Get bot's openclaw.json
 */

const { execFileSync } = require('child_process');
const { requireAdmin } = require('../auth/middleware.js');
const { validateTenantId, validateLines } = require('../util/validate.js');

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
        console.log(`[Admin] ${admin} restarting ${containerName}`);
        execFileSync('docker', ['restart', containerName], { encoding: 'utf8', timeout: 30000 });
        return res.json({ ok: true, message: `Restarted ${containerName}` });
      }

      case 'logs': {
        const lines = validateLines(req.query.lines);
        const logs = execFileSync('docker', ['logs', containerName, '--tail', String(lines)], {
          encoding: 'utf8',
          timeout: 10000
        });
        return res.json({ ok: true, logs: logs.split('\n') });
      }

      case 'config': {
        const config = execFileSync('docker', ['exec', containerName, 'cat', '/app/.openclaw/openclaw.json'], {
          encoding: 'utf8',
          timeout: 5000
        });
        return res.json({ ok: true, config: JSON.parse(config) });
      }

      case 'info': {
        const inspect = execFileSync('docker', ['inspect', containerName], {
          encoding: 'utf8',
          timeout: 5000
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
    console.error(`[Admin] Bot action failed for ${tenantId}:`, err.message);
    return res.status(500).json({ error: 'Bot operation failed' });
  }
};
