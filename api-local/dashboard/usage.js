/**
 * Get usage and cost data for a tenant
 * 
 * Queries clawops-usage table for real-time cost tracking
 */

const { QueryCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { requireAuth, requireBotOwnership } = require('../auth/middleware.js');

// Plan budget limits — from single source of truth (TASK-149)
const { PLAN_BUDGETS } = require('../data/plans.js');

module.exports = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const email = await requireAuth(req, res);
    if (!email) return;

    // Aggregate usage across all bots for the authenticated user
    if (!tenantId) {
      return handleEmailUsage(req, res, email);
    }

    // Auth + ownership check
    const bot = await requireBotOwnership(req, res, tenantId);
    if (!bot) return;
    
    // TASK-300: Get plan from team (user/account level)
    const { getUserPlan } = require('../auth/team-plan.js');
    const plan = await getUserPlan(bot.email);
    const budgetLimit = PLAN_BUDGETS[plan] || PLAN_BUDGETS.starter;
    
    // Get current month's usage
    const now = new Date();
    const monthStartMs = Date.UTC(now.getFullYear(), now.getMonth(), 1);
    
    const command = new QueryCommand({
      TableName: TABLES.USAGE,
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: {
        ':tid': { S: tenantId },
      }
    });
    
    const response = await dynamodb.send(command);
    
    // Aggregate usage data
    let totalCost = 0;
    let requestCount = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    const breakdown = {};
    const dailyCosts = {};
    
    if (response.Items) {
      for (const item of response.Items) {
        const record = unmarshall(item);
        const recordMs = getRecordTimeMs(record);
        if (recordMs !== null && recordMs < monthStartMs) continue;

        const { inputTokens, outputTokens } = extractTokenCounts(record);
        const cost = extractCost(record, inputTokens, outputTokens);
        totalCost += cost;
        requestCount += 1;
        tokensIn += inputTokens;
        tokensOut += outputTokens;
        
        const provider = record.provider || 'unknown';
        breakdown[provider] = (breakdown[provider] || 0) + cost;
        
        const day = getDayKey(record, recordMs);
        if (!day) continue;
        dailyCosts[day] = (dailyCosts[day] || 0) + cost;
      }
    }
    
    const today = now.toISOString().substring(0, 10);
    const todayCost = dailyCosts[today] || 0;
    const utilization = (totalCost / budgetLimit) * 100;
    const remaining = budgetLimit - totalCost;
    
    let alertLevel = 'ok';
    if (utilization >= 100) alertLevel = 'critical';
    else if (utilization >= 90) alertLevel = 'danger';
    else if (utilization >= 80) alertLevel = 'warning';
    
    res.json({
      tenantId,
      plan,
      budget: {
        limit: budgetLimit,
        used: totalCost,
        remaining: Math.max(0, remaining),
        utilization: Math.min(100, utilization),
        alertLevel
      },
      usage: { totalCost, todayCost, requestCount, tokensIn, tokensOut },
      breakdown,
      dailyCosts: Object.entries(dailyCosts).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date))
    });
    
  } catch (err) {
    console.error('Error getting usage:', err);
    console.error('[Usage] Error:', err.message);
    res.status(500).json({ error: 'Failed to get usage' });
  }
};

async function handleEmailUsage(req, res, email) {
  const scan = await dynamodb.send(new QueryCommand({
    TableName: TABLES.TENANTS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } }
  }));
  
  const tenants = (scan.Items || []).map(i => unmarshall(i));
  const now = new Date();
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
  const startMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  
  const dailyMap = {};
  
  for (const tenant of tenants) {
    try {
      const result = await dynamodb.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: {
          ':tid': { S: tenant.tenantId },
        }
      }));
      
      for (const item of (result.Items || [])) {
        const record = unmarshall(item);
        const recordMs = getRecordTimeMs(record);
        if (recordMs !== null && recordMs < startMs) continue;
        const day = getDayKey(record, recordMs);
        if (!day) continue;
        const { inputTokens, outputTokens } = extractTokenCounts(record);
        const messages = extractMessageCount(record);
        if (!dailyMap[day]) dailyMap[day] = { date: day, inputTokens: 0, outputTokens: 0, messageCount: 0 };
        dailyMap[day].inputTokens += inputTokens;
        dailyMap[day].outputTokens += outputTokens;
        dailyMap[day].messageCount += messages;
      }
    } catch (err) { console.error('[Usage] DynamoDB query failed:', err.message); }
  }
  
  const dailyUsage = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  
  return res.json({
    ok: true, email, days, dailyUsage,
    bots: tenants.map(t => ({ tenantId: t.tenantId, name: t.name || t.botName }))
  });
}

async function getTenant(tenantId) {
  try {
    const response = await dynamodb.send(new GetItemCommand({
      TableName: TABLES.TENANTS,
      Key: { tenantId: { S: tenantId } }
    }));
    return response.Item ? unmarshall(response.Item) : null;
  } catch (err) {
    console.error('Error getting tenant:', err);
    return null;
  }
}

function parseNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function extractTokenCounts(record) {
  const inputTokens = parseNumber(
    record.inputTokens,
    record.tokensIn,
    record.tokenIn,
    record.promptTokens,
    record.prompt_tokens,
    record.inputTokenCount,
    record.totalInputTokens,
    record.tokens_input
  ) || 0;
  const outputTokens = parseNumber(
    record.outputTokens,
    record.tokensOut,
    record.tokenOut,
    record.completionTokens,
    record.completion_tokens,
    record.outputTokenCount,
    record.totalOutputTokens,
    record.tokens_output
  ) || 0;
  return { inputTokens, outputTokens };
}

function extractMessageCount(record) {
  return parseNumber(
    record.messageCount,
    record.messages,
    record.requestCount,
    record.requests,
    record.totalRequests,
    record.message_count
  ) || 0;
}

function extractCost(record, inputTokens, outputTokens) {
  const explicitCost = parseNumber(
    record.cost,
    record.totalCost,
    record.costUsd,
    record.costUSD,
    record.estimatedCost
  );
  return explicitCost ?? estimateTokenCost(inputTokens, outputTokens);
}

function estimateTokenCost(inputTokens, outputTokens) {
  // Conservative default estimate (Sonnet-like pricing): $3/M input, $15/M output.
  return ((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15);
}

function getRecordTimeMs(record) {
  const timestamp = parseNumber(record.timestamp);
  if (timestamp !== null) return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;

  for (const field of [record.date, record.lastUpdated, record.updatedAt, record.createdAt]) {
    if (!field) continue;
    const numericField = parseNumber(field);
    if (numericField !== null) return numericField > 1_000_000_000_000 ? numericField : numericField * 1000;
    const parsed = Date.parse(field);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function getDayKey(record, recordMs) {
  if (typeof record.date === 'string') {
    const date = record.date.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.substring(0, 10);
    const numericDate = parseNumber(date);
    if (numericDate !== null) {
      const ms = numericDate > 1_000_000_000_000 ? numericDate : numericDate * 1000;
      return new Date(ms).toISOString().substring(0, 10);
    }
    const parsedDate = Date.parse(date);
    if (!Number.isNaN(parsedDate)) return new Date(parsedDate).toISOString().substring(0, 10);
  }
  if (typeof record.timestamp === 'string' && record.timestamp.length >= 10) {
    const numericTs = parseNumber(record.timestamp);
    if (numericTs !== null) {
      const ms = numericTs > 1_000_000_000_000 ? numericTs : numericTs * 1000;
      return new Date(ms).toISOString().substring(0, 10);
    }
    const parsed = Date.parse(record.timestamp);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().substring(0, 10);
  }
  if (typeof record.lastUpdated === 'string' && record.lastUpdated.length >= 10) {
    const parsed = Date.parse(record.lastUpdated);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().substring(0, 10);
  }
  if (recordMs !== null) return new Date(recordMs).toISOString().substring(0, 10);
  return null;
}
