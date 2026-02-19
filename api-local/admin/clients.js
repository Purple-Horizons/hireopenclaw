/**
 * Admin API — Client Management
 * GET /api/admin/clients — List all clients with stats
 * GET /api/admin/clients/:email — Single client detail
 */

const { requireAdmin } = require('../auth/middleware.js');
const { ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    // If requesting a specific client
    const targetEmail = req.params?.email;
    if (targetEmail) {
      const byEmail = await docClient.send(new QueryCommand({
        TableName: TABLES.TENANTS,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': targetEmail },
      }));
      const items = byEmail.Items || [];
      if (!items.length) return res.status(404).json({ error: 'Client not found' });

      const usageMap = await getMonthlyUsageByTenant(items.map(i => i.tenantId));
      const clients = buildClients(items, usageMap);
      const team = await getTeamForOwner(targetEmail);
      return res.json({ ok: true, client: clients[0], team });
    }

    // Scan all tenants (acceptable for admin — small table)
    // Support pagination via cursor
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const cursor = parseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }
    const data = await docClient.send(new ScanCommand({
      TableName: TABLES.TENANTS,
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));
    const items = data.Items || [];

    const usageMap = await getMonthlyUsageByTenant(items.map(i => i.tenantId));
    const clients = buildClients(items, usageMap);

    // Summary stats
    const summary = {
      totalClients: clients.length,
      activeClients: clients.filter(c => c.activeBots > 0).length,
      totalBots: items.length,
      activeBots: items.filter(i => i.status === 'active').length,
      terminatedBots: items.filter(i => i.status === 'terminated').length,
      unhealthyBots: items.filter(i => (i.healthStatus || 'unknown') === 'unhealthy').length,
      monthlyTokens: clients.reduce((sum, c) => sum + (c.usageMonth?.tokens || 0), 0),
      monthlyMessages: clients.reduce((sum, c) => sum + (c.usageMonth?.messages || 0), 0),
      monthlyCost: round2(clients.reduce((sum, c) => sum + (c.usageMonth?.cost || 0), 0)),
    };

    const nextCursor = data.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
      : null;

    return res.json({ ok: true, summary, clients, nextCursor });
  } catch (err) {
    console.error('[Admin] clients error:', err.message);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
};

async function getTeamForOwner(email) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.TEAMS || 'clawops-teams',
      IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId = :owner',
      ExpressionAttributeValues: { ':owner': email },
      Limit: 1,
    }));
    if (!result.Items?.length) return null;
    const team = result.Items[0];
    return {
      teamId: team.teamId,
      name: team.name || null,
      plan: team.plan || null,
      seats: Number.isFinite(team.seats) ? team.seats : null,
      createdAt: team.createdAt || null,
      updatedAt: team.updatedAt || null,
      lastLoginAt: team.lastLoginAt || team.lastLogin || team.lastSeenAt || null,
    };
  } catch (err) {
    console.warn('[Admin] team lookup failed:', err.message);
    return null;
  }
}

function buildClients(items, usageMap) {
  const clientMap = {};

  for (const item of items) {
    const email = item.email || 'unknown';
    const status = item.status || 'unknown';
    const tenantId = item.tenantId;
    const name = item.botName || item.name || tenantId;
    const createdAt = item.createdAt || item.provisionedAt;
    const health = item.healthStatus || 'unknown';
    const endpoint = item.endpoint;
    const port = item.port;
    const usage = usageMap[tenantId] || { tokens: 0, messages: 0, cost: 0, lastRequestAt: null };

    if (!clientMap[email]) {
      clientMap[email] = {
        email,
        bots: [],
        totalBots: 0,
        activeBots: 0,
        firstSeen: createdAt || null,
        lastActive: createdAt || null,
        usageMonth: { tokens: 0, messages: 0, cost: 0 },
      };
    }

    const client = clientMap[email];
    client.totalBots++;
    if (status === 'active') client.activeBots++;
    if (createdAt && (!client.firstSeen || toEpochMs(createdAt) < toEpochMs(client.firstSeen))) client.firstSeen = createdAt;

    const botLastActive = usage.lastRequestAt || createdAt || null;
    if (botLastActive && (!client.lastActive || toEpochMs(botLastActive) > toEpochMs(client.lastActive))) {
      client.lastActive = botLastActive;
    }

    client.usageMonth.tokens += usage.tokens;
    client.usageMonth.messages += usage.messages;
    client.usageMonth.cost += usage.cost;

    client.bots.push({
      tenantId,
      name,
      status,
      health,
      endpoint,
      port: port ? parseInt(port, 10) : null,
      createdAt,
      lastRequestAt: usage.lastRequestAt || null,
      usageMonth: {
        tokens: usage.tokens,
        messages: usage.messages,
        cost: round2(usage.cost),
      },
    });
  }

  return Object.values(clientMap)
    .map((client) => ({
      ...client,
      usageMonth: {
        tokens: client.usageMonth.tokens,
        messages: client.usageMonth.messages,
        cost: round2(client.usageMonth.cost),
      }
    }))
    .sort((a, b) => {
      if (a.activeBots !== b.activeBots) return b.activeBots - a.activeBots;
      return (b.lastActive || '').localeCompare(a.lastActive || '');
    });
}

async function getMonthlyUsageByTenant(tenantIds) {
  const map = {};
  const now = new Date();
  const monthStartMs = Date.UTC(now.getFullYear(), now.getMonth(), 1);

  await Promise.all((tenantIds || []).filter(Boolean).map(async (tenantId) => {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
      }));

      let tokens = 0;
      let messages = 0;
      let cost = 0;
      let lastRequestMs = null;

      for (const row of (result.Items || [])) {
        const ts = toRecordTimestampMs(row);
        if (ts !== null && ts < monthStartMs) continue;
        if (ts !== null && (lastRequestMs === null || ts > lastRequestMs)) lastRequestMs = ts;

        const input = toNum(
          row.inputTokens, row.tokensIn, row.tokenIn, row.promptTokens, row.prompt_tokens, row.inputTokenCount, row.totalInputTokens, row.tokens_input
        ) || 0;
        const output = toNum(
          row.outputTokens, row.tokensOut, row.tokenOut, row.completionTokens, row.completion_tokens, row.outputTokenCount, row.totalOutputTokens, row.tokens_output
        ) || 0;
        const msg = toNum(row.messageCount, row.messages, row.requestCount, row.requests, row.totalRequests, row.message_count) || 0;
        const rowCost = toNum(row.cost, row.totalCost, row.costUsd, row.costUSD, row.estimatedCost);

        tokens += input + output;
        messages += msg;
        cost += rowCost !== null ? rowCost : estimateCost(input, output);
      }

      map[tenantId] = {
        tokens,
        messages,
        cost: round2(cost),
        lastRequestAt: lastRequestMs !== null ? new Date(lastRequestMs).toISOString() : null,
      };
    } catch (err) {
      console.warn(`[Admin] usage lookup failed for ${tenantId}:`, err.message);
      map[tenantId] = { tokens: 0, messages: 0, cost: 0, lastRequestAt: null };
    }
  }));

  return map;
}

function toNum(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function toRecordTimestampMs(row) {
  const ts = toNum(row.timestamp);
  if (ts !== null) return ts > 1_000_000_000_000 ? ts : ts * 1000;

  for (const field of [row.date, row.lastUpdated, row.updatedAt, row.createdAt]) {
    if (!field) continue;
    const numeric = toNum(field);
    if (numeric !== null) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(field);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function estimateCost(inputTokens, outputTokens) {
  return ((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toEpochMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString();
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
