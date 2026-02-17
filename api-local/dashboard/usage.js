/**
 * Get usage and cost data for a tenant
 * 
 * Queries clawops-usage table for real-time cost tracking
 */

const { QueryCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { requireBotOwnership } = require('../auth/middleware.js');

// Plan budget limits — from single source of truth (TASK-149)
const { PLAN_BUDGETS } = require('../data/plans.js');

module.exports = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const email = req.query.email;
    
    // Email-based: aggregate usage across all bots for this user
    if (!tenantId && email) {
      return handleEmailUsage(req, res, email);
    }
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }

    // Auth + ownership check
    const bot = await requireBotOwnership(req, res, tenantId);
    if (!bot) return;
    
    // Get tenant's plan
    const tenant = await getTenant(tenantId);
    const plan = tenant?.plan || 'starter';
    const budgetLimit = PLAN_BUDGETS[plan] || PLAN_BUDGETS.starter;
    
    // Get current month's usage
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    const command = new QueryCommand({
      TableName: TABLES.USAGE,
      KeyConditionExpression: 'tenantId = :tid AND #d >= :monthStart',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: {
        ':tid': { S: tenantId },
        ':monthStart': { S: monthStart }
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
        const cost = parseFloat(record.cost || 0);
        totalCost += cost;
        requestCount += 1;
        tokensIn += parseInt(record.inputTokens || record.tokensIn || 0);
        tokensOut += parseInt(record.outputTokens || record.tokensOut || 0);
        
        const provider = record.provider || 'unknown';
        breakdown[provider] = (breakdown[provider] || 0) + cost;
        
        const day = (record.timestamp || record.date || record.lastUpdated || '').substring(0, 10);
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
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  
  const dailyMap = {};
  
  for (const tenant of tenants) {
    try {
      const result = await dynamodb.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid AND #d >= :start',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: {
          ':tid': { S: tenant.tenantId },
          ':start': { S: startDate }
        }
      }));
      
      for (const item of (result.Items || [])) {
        const record = unmarshall(item);
        const day = record.date;
        if (!dailyMap[day]) dailyMap[day] = { date: day, inputTokens: 0, outputTokens: 0, messageCount: 0 };
        dailyMap[day].inputTokens += parseInt(record.inputTokens || 0);
        dailyMap[day].outputTokens += parseInt(record.outputTokens || 0);
        dailyMap[day].messageCount += parseInt(record.messageCount || 0);
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
