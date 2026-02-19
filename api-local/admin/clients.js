/**
 * Admin API — Client Management
 * GET /api/admin/clients — List all clients with stats
 * GET /api/admin/clients/:email — Single client detail
 * PATCH /api/admin/clients/:email — Update client team fields
 * PATCH /api/admin/clients/:email/tenants/:tenantId — Update tenant metadata
 * DELETE /api/admin/clients/:email/tenants/:tenantId — Archive tenant instance
 */

const { requireAdmin } = require('../auth/middleware.js');
const { ScanCommand, QueryCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { validateEmail, validateTenantId, validateBotName, validatePlan } = require('../util/validate.js');

const VALID_BOT_STATUSES = new Set(['active', 'paused', 'terminated', 'provisioning', 'error']);
const VALID_HEALTH_STATUSES = new Set(['healthy', 'unhealthy', 'pending', 'unknown']);

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const targetEmail = req.params?.email;
    const targetTenantId = req.params?.tenantId;

    if (targetTenantId) {
      if (req.method === 'PATCH') {
        return handleTenantUpdate(res, targetEmail, targetTenantId, req.body || {}, admin);
      }
      if (req.method === 'DELETE') {
        return handleTenantArchive(res, targetEmail, targetTenantId, admin);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // If requesting a specific client
    if (targetEmail) {
      if (!validateEmail(targetEmail)) {
        return res.status(400).json({ error: 'Invalid client email format' });
      }

      if (req.method === 'PATCH') {
        return handleClientUpdate(res, targetEmail, req.body || {}, admin);
      }

      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

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

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
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

async function handleClientUpdate(res, email, payload, adminEmail) {
  const team = await getTeamForOwner(email);
  if (!team?.teamId) return res.status(404).json({ error: 'Team not found for client' });

  const updates = {};
  const teamPatch = payload.team || {};

  if (teamPatch.name !== undefined) {
    const nextName = String(teamPatch.name || '').trim();
    if (!nextName || nextName.length > 120) {
      return res.status(400).json({ error: 'Invalid team.name (1-120 chars required)' });
    }
    updates.name = nextName;
  }

  if (teamPatch.plan !== undefined) {
    if (!validatePlan(teamPatch.plan)) return res.status(400).json({ error: 'Invalid team.plan' });
    updates.plan = teamPatch.plan;
  }

  if (teamPatch.seats !== undefined) {
    const seats = Number(teamPatch.seats);
    if (!Number.isFinite(seats) || seats < 1 || seats > 1000) {
      return res.status(400).json({ error: 'Invalid team.seats (must be 1-1000)' });
    }
    updates.seats = Math.floor(seats);
  }

  if (payload.adminNotes !== undefined) {
    const notes = String(payload.adminNotes || '').trim();
    if (notes.length > 2000) return res.status(400).json({ error: 'adminNotes too long (max 2000 chars)' });
    updates.adminNotes = notes;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  const now = new Date().toISOString();
  const names = {};
  const values = { ':now': now, ':admin': adminEmail };
  const clauses = ['updatedAt = :now', 'updatedBy = :admin'];
  let idx = 0;
  for (const [key, value] of Object.entries(updates)) {
    idx += 1;
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    names[nameKey] = key;
    values[valueKey] = value;
    clauses.push(`${nameKey} = ${valueKey}`);
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TEAMS || 'clawops-teams',
    Key: { teamId: team.teamId },
    UpdateExpression: `SET ${clauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));

  const refreshed = await getTeamForOwner(email);
  return res.json({ ok: true, team: refreshed });
}

async function handleTenantUpdate(res, email, tenantId, payload, adminEmail) {
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid client email format' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  const tenant = await getTenantOwnedBy(email, tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found for client' });

  const updates = {};
  if (payload.name !== undefined) {
    if (!validateBotName(payload.name)) {
      return res.status(400).json({ error: 'Invalid tenant name format' });
    }
    updates.name = payload.name;
  }

  if (payload.status !== undefined) {
    const status = String(payload.status || '').trim();
    if (!VALID_BOT_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid tenant status (${[...VALID_BOT_STATUSES].join(', ')})` });
    }
    updates.status = status;
  }

  if (payload.healthStatus !== undefined) {
    const health = String(payload.healthStatus || '').trim();
    if (!VALID_HEALTH_STATUSES.has(health)) {
      return res.status(400).json({ error: `Invalid healthStatus (${[...VALID_HEALTH_STATUSES].join(', ')})` });
    }
    updates.healthStatus = health;
  }

  if (payload.role !== undefined) {
    const role = String(payload.role || '').trim();
    if (!role || role.length > 80) {
      return res.status(400).json({ error: 'Invalid role (1-80 chars required)' });
    }
    updates.role = role;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid tenant fields provided for update' });
  }

  const now = new Date().toISOString();
  const names = {};
  const values = { ':now': now, ':admin': adminEmail };
  const clauses = ['updatedAt = :now', 'updatedBy = :admin'];
  let idx = 0;
  for (const [key, value] of Object.entries(updates)) {
    idx += 1;
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    names[nameKey] = key;
    values[valueKey] = value;
    clauses.push(`${nameKey} = ${valueKey}`);
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
    UpdateExpression: `SET ${clauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));

  const refreshed = await getTenantOwnedBy(email, tenantId);
  return res.json({ ok: true, tenant: toTenantView(refreshed) });
}

async function handleTenantArchive(res, email, tenantId, adminEmail) {
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid client email format' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  const tenant = await getTenantOwnedBy(email, tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found for client' });

  const now = new Date().toISOString();
  await docClient.send(new UpdateCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
    UpdateExpression: 'SET #status = :status, archivedAt = :now, updatedAt = :now, updatedBy = :admin',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'terminated',
      ':now': now,
      ':admin': adminEmail,
    },
  }));

  return res.json({ ok: true, archived: true, tenantId });
}

async function getTenantOwnedBy(email, tenantId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
  }));
  if (!result.Item) return null;
  if (result.Item.email !== email) return null;
  return result.Item;
}

function toTenantView(item) {
  if (!item) return null;
  return {
    tenantId: item.tenantId,
    email: item.email,
    name: item.botName || item.name || item.tenantId,
    status: item.status || 'unknown',
    healthStatus: item.healthStatus || 'unknown',
    role: item.role || null,
    updatedAt: item.updatedAt || null,
    updatedBy: item.updatedBy || null,
  };
}

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
      adminNotes: team.adminNotes || '',
      createdAt: team.createdAt || null,
      updatedAt: team.updatedAt || null,
      updatedBy: team.updatedBy || null,
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
    const role = item.role || null;
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
      role,
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
