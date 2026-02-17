/**
 * Cost Margin API - Calculate revenue vs. costs per customer
 * GET /api/dashboard/margin?email=user@example.com
 */

const { execSync } = require('child_process');

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

// Plan pricing
const PLAN_PRICING = {
  starter:    { price: 29,  maxBots: 1 },
  pro:        { price: 99,  maxBots: 3 },
  business:   { price: 299, maxBots: 10 },
  enterprise: { price: 999, maxBots: 50 }
};

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

function getBotsForEmail(email) {
  try {
    // clawops-tenants uses tenantId as PK; scan with filter for email
    const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb scan \
      --table-name clawops-tenants \
      --filter-expression "email = :email AND #s <> :terminated" \
      --expression-attribute-names '{"#s":"status"}' \
      --expression-attribute-values '{":email":{"S":"${email}"},":terminated":{"S":"terminated"}}' \
      --output json`;
    
    const result = execSync(cmd, { encoding: 'utf8', env: { ...process.env, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' } });
    return JSON.parse(result).Items || [];
  } catch (err) {
    console.error('Failed to fetch bots:', err.message);
    return [];
  }
}

function getUsageData(email) {
  // Get user's bots first, then query usage per bot
  const botItems = getBotsForEmail(email);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalMessages = 0;

  for (const bot of botItems) {
    const tenantId = bot.tenantId?.S;
    if (!tenantId) continue;
    try {
      const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb query \
        --table-name clawops-usage \
        --key-condition-expression "tenantId = :tid" \
        --expression-attribute-values '{":tid":{"S":"${tenantId}"}}' \
        --output json`;
      const result = execSync(cmd, { encoding: 'utf8', env: { ...process.env, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' } });
      const data = JSON.parse(result);
      for (const item of (data.Items || [])) {
        totalInputTokens += parseInt(item.inputTokens?.N || 0);
        totalOutputTokens += parseInt(item.outputTokens?.N || 0);
        totalMessages += parseInt(item.messageCount?.N || 0);
      }
    } catch {}
  }
  return { totalInputTokens, totalOutputTokens, totalMessages };
}

function getBotsData(email) {
  const botItems = getBotsForEmail(email);
  const bots = [];
  let totalUptimeHours = 0;

  for (const item of botItems) {
    const createdAt = item.createdAt?.S || item.provisionedAt?.S;
    const model = item.model?.S || 'gpt-4o';

    if (createdAt) {
      const uptimeHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
      totalUptimeHours += uptimeHours;
      bots.push({ model, uptimeHours });
    }
  }
  return { bots, totalUptimeHours };
}

const { requireAuth, getEmailFromSession } = require('../auth/middleware.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use session email (trusted)
  const email = getEmailFromSession(req) || req.query.email;

  if (!email) {
    return res.status(401).json({ error: 'Unauthorized — no valid session' });
  }

  console.log(`[Margin API] Calculating margin for ${email}`);

  try {
    // Get usage data
    const usage = getUsageData(email);
    
    // Get bots data
    const { bots, totalUptimeHours } = getBotsData(email);
    
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
    // TODO: Fetch real plan from user/billing record
    const plan = 'starter';
    const revenue = PLAN_PRICING[plan].price;
    
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
