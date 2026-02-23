/**
 * Billing API - LocalStack Version
 * GET /api/dashboard/billing
 */

const { requireAuth } = require('../auth/middleware.js');
const teamPlan = require('../auth/team-plan.js');
const { QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { normalizeUsagePolicy } = require('../billing/team-billing.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = await requireAuth(req, res);
  if (!email) return;

  const { PLAN_PRICING, PLAN_TOKEN_LIMITS } = require('../data/plans.js');
  const PLANS = {};
  for (const [k, v] of Object.entries(PLAN_PRICING)) {
    PLANS[k] = { price: v.price, tokens: PLAN_TOKEN_LIMITS[k], maxBots: v.maxBots };
  }

  const [plan, team] = await Promise.all([
    teamPlan.getUserPlan(email),
    typeof teamPlan.getTeamByOwner === 'function'
      ? teamPlan.getTeamByOwner(email)
      : Promise.resolve(null),
  ]);
  const planInfo = PLANS[plan] || PLANS.starter;
  const usage = await getMonthlyUsage(email);

  const hasNumericPrice = typeof planInfo.price === 'number' && Number.isFinite(planInfo.price);
  const hasTokenLimit = Number.isFinite(planInfo.tokens);
  const tokensLimit = hasTokenLimit ? planInfo.tokens : null;
  const percentUsed = tokensLimit ? Math.min(100, (usage.tokensUsed / tokensLimit) * 100) : null;
  const usagePolicy = normalizeUsagePolicy(team?.usagePolicy);
  const tokensOver = tokensLimit ? Math.max(0, usage.tokensUsed - tokensLimit) : 0;
  const estimatedOverageCost = tokensOver > 0
    ? (tokensOver / 1_000_000) * 15
    : 0;

  return res.status(200).json({
    plan,
    planPrice: hasNumericPrice ? planInfo.price : null,
    customPlan: !hasNumericPrice,
    status: team?.billingStatus || 'active',
    stripeConnected: Boolean(team?.stripeCustomerId),
    stripeCustomerId: team?.stripeCustomerId || null,
    stripeSubscriptionId: team?.stripeSubscriptionId || null,
    billingCycle: 'monthly',
    nextBillingDate: team?.currentPeriodEnd
      || (hasNumericPrice
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null),
    currentPeriod: {
      start: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      end: team?.currentPeriodEnd
        || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    },
    usagePolicy,
    usage: {
      tokensUsed: usage.tokensUsed,
      estimatedCost: usage.estimatedCost,
      tokensLimit,
      percentUsed,
      tokensOver,
      estimatedOverageCost,
    },
    upcomingInvoice: {
      amount: hasNumericPrice ? planInfo.price * 100 : null, // cents
      currency: 'usd',
      date: team?.currentPeriodEnd || (hasNumericPrice
        ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
        : null),
    },
    bots: {
      count: usage.botCount,
    },
  });
};

async function getMonthlyUsage(email) {
  const now = new Date();
  const monthStartMs = Date.UTC(now.getFullYear(), now.getMonth(), 1);

  const tenantsResult = await dynamodb.send(new QueryCommand({
    TableName: TABLES.TENANTS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } },
  }));

  const tenants = (tenantsResult.Items || []).map(unmarshall);
  let tokensUsed = 0;
  let estimatedCost = 0;

  for (const tenant of tenants) {
    if (!tenant.tenantId) continue;
    const usageResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.USAGE,
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: { ':tid': { S: tenant.tenantId } },
      Limit: 10000, // PH-104: Bound query
    }));

    for (const raw of (usageResult.Items || [])) {
      const item = unmarshall(raw);
      const recordMs = getRecordTimeMs(item);
      if (recordMs !== null && recordMs < monthStartMs) continue;
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
      tokensUsed += input + output;
      estimatedCost += toNumber(
        item.cost,
        item.totalCost,
        item.costUsd,
        item.costUSD,
        item.estimatedCost
      ) ?? estimateTokenCost(input, output);
    }
  }

  return { tokensUsed, estimatedCost, botCount: tenants.length };
}

function getRecordTimeMs(record) {
  const ts = toNumber(record.timestamp);
  if (ts !== null) return ts > 1_000_000_000_000 ? ts : ts * 1000;

  for (const field of [record.date, record.lastUpdated, record.updatedAt, record.createdAt]) {
    if (!field) continue;
    const numericField = toNumber(field);
    if (numericField !== null) return numericField > 1_000_000_000_000 ? numericField : numericField * 1000;
    const parsed = Date.parse(field);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function toNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function estimateTokenCost(inputTokens, outputTokens) {
  return ((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15);
}
