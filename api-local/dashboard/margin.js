/**
 * Cost Margin API - Calculate revenue vs. costs per customer
 * GET /api/dashboard/margin
 */

const { QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');

// Model costs per 1M tokens (as of Feb 2026)
const MODEL_COSTS = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-4': { input: 0.80, output: 4.00 },
  'default': { input: 2.50, output: 10.00 } // Assume GPT-4o if unknown
};

// Fargate costs (us-east-1, as of Feb 2026)
const FARGATE_COST_PER_HOUR = 0.04048; // 0.25 vCPU + 0.5 GB memory

// Plan pricing — from single source of truth (TASK-149)
const { PLAN_PRICING } = require('../data/plans.js');
const { getUserPlan } = require('../auth/team-plan.js');

function calculateCost(inputTokens, outputTokens, model = 'gpt-4o', uptimeHours = 0) {
  const modelCost = MODEL_COSTS[model] || MODEL_COSTS.default;
  
  // Token costs
  const inputCost = (inputTokens / 1_000_000) * modelCost.input;
  const outputCost = (outputTokens / 1_000_000) * modelCost.output;
  const tokenCost = inputCost + outputCost;
  
  // Compute costs
  const computeCost = uptimeHours * FARGATE_COST_PER_HOUR;
  
  return {
    tokenCost,
    computeCost,
    totalCost: tokenCost + computeCost
  };
}

async function getBotsForEmail(email) {
  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TABLES.TENANTS,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': { S: email }
      }
    }));
    return (result.Items || [])
      .map(unmarshall)
      .filter((item) => item.status !== 'terminated');
  } catch (err) {
    console.error('Failed to fetch bots:', err.message);
    return [];
  }
}

async function getUsageData(email) {
  // Get user's bots first, then query usage per bot
  const botItems = await getBotsForEmail(email);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalMessages = 0;

  for (const bot of botItems) {
    const tenantId = bot.tenantId;
    if (!tenantId) continue;
    try {
      const result = await dynamodb.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: {
          ':tid': { S: tenantId }
        }
      }));
      for (const rawItem of (result.Items || [])) {
        const item = unmarshall(rawItem);
        totalInputTokens += parseInt(item.inputTokens || 0, 10);
        totalOutputTokens += parseInt(item.outputTokens || 0, 10);
        totalMessages += parseInt(item.messageCount || 0, 10);
      }
    } catch (err) { console.error('[Margin] DynamoDB query failed:', err.message); }
  }
  return { totalInputTokens, totalOutputTokens, totalMessages };
}

async function getBotsData(email) {
  const botItems = await getBotsForEmail(email);
  const bots = [];
  let totalUptimeHours = 0;

  for (const item of botItems) {
    const createdAt = item.createdAt || item.provisionedAt;
    const model = item.model || 'gpt-4o';

    if (createdAt) {
      const uptimeHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
      totalUptimeHours += uptimeHours;
      bots.push({ model, uptimeHours });
    }
  }
  return { bots, totalUptimeHours };
}

const { requireAuth } = require('../auth/middleware.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = await requireAuth(req, res);
  if (!email) return;

  console.log(`[Margin API] Calculating margin for ${email}`);

  try {
    // Get usage data
    const usage = await getUsageData(email);
    
    // Get bots data
    const { bots, totalUptimeHours } = await getBotsData(email);
    
    // Calculate average model (use most common or default to gpt-4o)
    const modelCounts = {};
    for (const bot of bots) {
      modelCounts[bot.model] = (modelCounts[bot.model] || 0) + 1;
    }
    const avgModel = Object.keys(modelCounts).sort((a, b) => modelCounts[b] - modelCounts[a])[0] || 'gpt-4o';
    
    // Calculate costs
    const costs = calculateCost(
      usage.totalInputTokens,
      usage.totalOutputTokens,
      avgModel,
      totalUptimeHours
    );
    
    // Get plan and revenue
    const plan = await getUserPlan(email);
    const revenue = (PLAN_PRICING[plan] || PLAN_PRICING.starter).price;
    
    // Calculate margin
    const margin = revenue - costs.totalCost;
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;
    
    return res.status(200).json({
      ok: true,
      email,
      plan,
      revenue,
      costs: {
        tokens: costs.tokenCost.toFixed(2),
        compute: costs.computeCost.toFixed(2),
        total: costs.totalCost.toFixed(2)
      },
      margin: {
        amount: margin.toFixed(2),
        percent: marginPercent.toFixed(1),
        status: marginPercent > 70 ? 'healthy' : marginPercent > 50 ? 'warning' : 'critical'
      },
      usage: {
        inputTokens: usage.totalInputTokens,
        outputTokens: usage.totalOutputTokens,
        messages: usage.totalMessages
      },
      bots: {
        count: bots.length,
        uptimeHours: totalUptimeHours.toFixed(1),
        avgModel
      }
    });

  } catch (error) {
    console.error(`[Margin API] Error:`, error);
    return res.status(500).json({
      error: 'Failed to calculate margin'
    });
  }
};
