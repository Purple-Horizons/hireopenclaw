/**
 * Container Stats API - LocalStack Version
 * GET /api/dashboard/container-stats?tenantId=xxx
 * Returns live Docker stats for a container
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const { requireBotOwnership } = require('../auth/middleware.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId } = req.query;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId parameter required' });
  }

  // Auth + ownership check
  const bot = await requireBotOwnership(req, res, tenantId);
  if (!bot) return;

  try {
    const containerName = `clawops-${tenantId}`;

    // Get docker stats (one-shot)
    const statsCmd = `docker stats --no-stream --format json ${containerName}`;
    const { stdout: statsOutput } = await execAsync(statsCmd);
    const stats = JSON.parse(statsOutput);

    // Get docker inspect for additional metadata
    const inspectCmd = `docker inspect ${containerName}`;
    const { stdout: inspectOutput } = await execAsync(inspectCmd);
    const inspect = JSON.parse(inspectOutput)[0];

    // Calculate uptime
    const startedAt = new Date(inspect.State.StartedAt);
    const uptimeMs = Date.now() - startedAt.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    // Parse memory usage and normalize to MB
    const memMatch = stats.MemUsage.match(/([\d.]+)([KMGT]iB)/);
    let memMB = 0;
    if (memMatch) {
      const val = parseFloat(memMatch[1]);
      const unit = memMatch[2];
      if (unit === 'GiB') memMB = Math.round(val * 1024);
      else if (unit === 'MiB') memMB = Math.round(val);
      else if (unit === 'KiB') memMB = Math.round(val / 1024);
      else if (unit === 'TiB') memMB = Math.round(val * 1024 * 1024);
    }
    const memValue = memMB;
    const memUnit = 'MB';

    return res.status(200).json({
      ok: true,
      tenantId,
      containerName,
      stats: {
        cpuPercent: stats.CPUPerc,
        memoryUsage: stats.MemUsage,
        memoryPercent: stats.MemPerc,
        memoryValue: memValue,
        memoryUnit: memUnit,
        networkIO: stats.NetIO,
        blockIO: stats.BlockIO,
        pids: stats.PIDs
      },
      metadata: {
        status: inspect.State.Status,
        health: inspect.State.Health?.Status || 'unknown',
        startedAt: inspect.State.StartedAt,
        uptimeSeconds,
        uptimeFormatted: formatUptime(uptimeSeconds),
        restartCount: inspect.RestartCount,
        pid: inspect.State.Pid
      }
    });

  } catch (error) {
    console.error('[Container Stats] Error:', error);
    return res.status(500).json({
      error: 'Failed to get container stats'
    });
  }
};

// Format uptime as "3d 2h 15m"
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}
