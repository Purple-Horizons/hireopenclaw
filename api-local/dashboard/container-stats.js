/**
 * Container Stats API - LocalStack Version
 * GET /api/dashboard/container-stats?tenantId=xxx
 * Returns live Docker stats for a container
 */

const { getContainer } = require('../util/docker-sdk.js');
const { requireBotOwnership } = require('../auth/middleware.js');
const { validateTenantId } = require('../util/validate.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId } = req.query;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId parameter required' });
  }

  if (!validateTenantId(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId format' });
  }

  // Auth + ownership check
  const bot = await requireBotOwnership(req, res, tenantId);
  if (!bot) return;

  try {
    const containerName = `clawops-${tenantId}`;
    const container = await getContainer(containerName);

    // dockerode one-shot stats + inspect (no shell command execution)
    const [stats, inspect] = await Promise.all([
      container.stats({ stream: false }),
      container.inspect(),
    ]);

    // Calculate uptime
    const startedAt = new Date(inspect.State.StartedAt);
    const uptimeMs = Date.now() - startedAt.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    const cpuPercent = calculateCpuPercent(stats);
    const memUsageBytes = stats.memory_stats?.usage || 0;
    const memLimitBytes = stats.memory_stats?.limit || 0;
    const memPercent = memLimitBytes > 0 ? ((memUsageBytes / memLimitBytes) * 100) : 0;
    const network = calculateNetworkIO(stats.networks);
    const block = calculateBlockIO(stats.blkio_stats?.io_service_bytes_recursive || []);
    const pids = stats.pids_stats?.current || 0;

    return res.status(200).json({
      ok: true,
      tenantId,
      containerName,
      stats: {
        cpuPercent,
        memoryUsage: `${formatBytes(memUsageBytes)} / ${formatBytes(memLimitBytes)}`,
        memoryPercent: `${memPercent.toFixed(2)}%`,
        memoryValue: Math.round(memUsageBytes / (1024 * 1024)),
        memoryUnit: 'MB',
        networkIO: `${formatBytes(network.rx)} / ${formatBytes(network.tx)}`,
        blockIO: `${formatBytes(block.read)} / ${formatBytes(block.write)}`,
        pids
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
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Container not found' });
    }
    return res.status(500).json({
      error: 'Failed to get container stats'
    });
  }
};

function calculateCpuPercent(stats) {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) -
    (stats.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus = stats.cpu_stats?.online_cpus ||
    stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  if (systemDelta <= 0 || cpuDelta <= 0) return '0.00%';
  return `${((cpuDelta / systemDelta) * onlineCpus * 100).toFixed(2)}%`;
}

function calculateNetworkIO(networks = {}) {
  return Object.values(networks).reduce(
    (acc, net) => {
      acc.rx += net.rx_bytes || 0;
      acc.tx += net.tx_bytes || 0;
      return acc;
    },
    { rx: 0, tx: 0 }
  );
}

function calculateBlockIO(entries = []) {
  return entries.reduce(
    (acc, entry) => {
      const op = (entry.op || '').toLowerCase();
      if (op === 'read') acc.read += entry.value || 0;
      if (op === 'write') acc.write += entry.value || 0;
      return acc;
    },
    { read: 0, write: 0 }
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

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
