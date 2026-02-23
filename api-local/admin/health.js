/**
 * Admin System Health Panel API (PH-086)
 * GET /api/admin/health — proxy, DynamoDB, ECS, secrets status
 */

const { requireAdmin } = require('../auth/middleware.js');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = await requireAdmin(req, res);
  if (!email) return;

  const checks = await Promise.allSettled([
    checkDynamoDB(),
    checkProxy(),
    checkTenants(),
  ]);

  const [dynamo, proxy, tenants] = checks.map(c =>
    c.status === 'fulfilled' ? c.value : { status: 'error', error: c.reason?.message }
  );

  const allHealthy = [dynamo, proxy, tenants].every(c => c.status === 'healthy');

  return res.status(200).json({
    overall: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: { dynamodb: dynamo, proxy, tenants },
  });
};

async function checkDynamoDB() {
  const tables = [
    TABLES.TENANTS, TABLES.TEAMS, TABLES.USAGE,
    TABLES.AUTH_TOKENS, TABLES.WAITLIST,
  ].filter(Boolean);

  const results = [];
  for (const table of tables) {
    try {
      const desc = await dynamodb.send(new DescribeTableCommand({ TableName: table }));
      const status = desc.Table?.TableStatus;
      results.push({ table, status: status === 'ACTIVE' ? 'healthy' : 'degraded', tableStatus: status });
    } catch (err) {
      results.push({ table, status: 'error', error: err.message });
    }
  }

  const allHealthy = results.every(r => r.status === 'healthy');
  return { status: allHealthy ? 'healthy' : 'degraded', tables: results };
}

async function checkProxy() {
  const proxyUrl = process.env.CLAWOPS_PROXY_URL || process.env.PROXY_URL || 'https://api.hireopenclaw.com';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json();
    return {
      status: data.status === 'ok' ? 'healthy' : 'degraded',
      url: proxyUrl,
      providers: data.providers || [],
      responseTime: null, // could add timing
    };
  } catch (err) {
    return { status: 'error', url: proxyUrl, error: err.message };
  }
}

async function checkTenants() {
  try {
    const { ScanCommand } = require('@aws-sdk/client-dynamodb');
    const { unmarshall } = require('@aws-sdk/util-dynamodb');
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLES.TENANTS,
      ProjectionExpression: 'tenantId, #s, lastActive, healthStatus',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 100,
    }));

    const tenants = (result.Items || []).map(unmarshall);
    const active = tenants.filter(t => t.status === 'active').length;
    const paused = tenants.filter(t => t.status === 'paused').length;
    const terminated = tenants.filter(t => t.status === 'terminated').length;
    const unhealthy = tenants.filter(t => t.healthStatus === 'unhealthy').length;

    return {
      status: unhealthy > 0 ? 'degraded' : 'healthy',
      total: tenants.length,
      active,
      paused,
      terminated,
      unhealthy,
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}
