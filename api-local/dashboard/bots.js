/**
 * Dashboard Bots API - LocalStack Version
 * GET /api/dashboard/bots
 * Lists all bots for the authenticated user (email from session)
 */

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { QueryCommand: RawQueryCommand } = require('@aws-sdk/client-dynamodb');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { client: dynamoClient, docClient, TABLES } = require('../util/dynamodb.js');
const { requireAuth } = require('../auth/middleware.js');
const { getUserPlan, getMaxBots: getMaxBotsForUser } = require('../auth/team-plan.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = await requireAuth(req, res);
  if (!email) return;

  try {
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';

    // Query by email using GSI (email-index)
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }));

    const tenants = result.Items || [];

    // Fetch current month's usage from clawops-usage for each active tenant
    const activeTenants = tenants.filter(t => t.status === 'active' || t.status === 'paused');
    const usageMap = await getMonthlyUsage(activeTenants.map(t => t.tenantId));

    // Transform to dashboard format
    const bots = activeTenants
      .map(t => {
        const usage = usageMap[t.tenantId] || { tokens: 0, messages: 0 };
        return {
          id: t.tenantId,
          name: t.name || 'Unnamed Bot',
          role: t.role || 'Assistant',
          template: t.template || 'blank',
          status: t.status,
          health: t.healthStatus || 'unknown',
          plan: t.plan || 'starter',
          tokensUsed: usage.tokens,
          tokensLimit: getTokenLimit(t.plan),
          messagesToday: usage.messages,
          lastActive: toTimestampMs(t.lastActive) || toTimestampMs(t.createdAt),
          createdAt: t.createdAt,
          endpoint: t.endpoint || null,
          model: t.model || null
        };
      });

    // Aggregate stats
    const totalTokensUsed = bots.reduce((sum, b) => sum + b.tokensUsed, 0);
    const totalTokensLimit = bots.reduce((sum, b) => sum + b.tokensLimit, 0);

    // TASK-300: Get plan from team (user/account level), not from bot records
    const plan = await getUserPlan(email);
    const maxBots = await getMaxBotsForUser(email);

    const { withETag } = require('../util/etag.js');
    return withETag(req, res, {
      bots,
      plan,
      maxBots,
      totalTokensUsed,
      totalTokensLimit
    });

  } catch (error) {
    console.error('[Dashboard Bots] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch bots'
    });
  }
};

// Fetch current month's usage from clawops-usage table for multiple tenants
async function getMonthlyUsage(tenantIds) {
  const now = new Date();
  const monthStartMs = Date.UTC(now.getFullYear(), now.getMonth(), 1);
  const usageMap = {};

  await Promise.all(tenantIds.map(async (tenantId) => {
    try {
      const result = await dynamoClient.send(new RawQueryCommand({
        TableName: 'clawops-usage',
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: {
          ':tid': { S: tenantId },
        }
      }));

      let tokens = 0, messages = 0;
      for (const raw of (result.Items || [])) {
        const item = unmarshall(raw);
        const ts = toRecordTimestampMs(item);
        if (ts !== null && ts < monthStartMs) continue;
        const input = toNumber(
          item.inputTokens,
          item.tokensIn,
          item.tokenIn,
          item.promptTokens,
          item.prompt_tokens,
          item.inputTokenCount,
          item.totalInputTokens,
          item.tokens_input
        ) || 0;
        const output = toNumber(
          item.outputTokens,
          item.tokensOut,
          item.tokenOut,
          item.completionTokens,
          item.completion_tokens,
          item.outputTokenCount,
          item.totalOutputTokens,
          item.tokens_output
        ) || 0;
        const messageCount = toNumber(
          item.messageCount,
          item.messages,
          item.requestCount,
          item.requests,
          item.totalRequests,
          item.message_count
        ) || 0;
        tokens += input + output;
        messages += messageCount;
      }
      usageMap[tenantId] = { tokens, messages };
    } catch (err) {
      console.error(`[Bots] Usage fetch failed for ${tenantId}:`, err.message);
      usageMap[tenantId] = { tokens: 0, messages: 0 };
    }
  }));

  return usageMap;
}

function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return value > 1_000_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toRecordTimestampMs(record) {
  const numericTs = toNumber(record.timestamp);
  if (numericTs !== null) return numericTs > 1_000_000_000_000 ? numericTs : numericTs * 1000;
  for (const field of [record.date, record.lastUpdated, record.updatedAt, record.createdAt]) {
    const numericField = toNumber(field);
    if (numericField !== null) return numericField > 1_000_000_000_000 ? numericField : numericField * 1000;
    const parsed = Date.parse(field || '');
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function toNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

// Helper: Get token limit by plan
function getTokenLimit(plan) {
  const limits = {
    starter: 500000,
    pro: 2000000,
    business: 5000000,
    enterprise: 20000000
  };
  return limits[plan] || limits.starter;
}

// Helper: Get max bots by plan
function getMaxBots(plan) {
  const maxes = {
    starter: 1,
    pro: 3,
    business: 10,
    enterprise: 50
  };
  return maxes[plan] || maxes.starter;
}
