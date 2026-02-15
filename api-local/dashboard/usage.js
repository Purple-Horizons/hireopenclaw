/**
 * Get usage and cost data for a tenant
 * 
 * Queries clawops-usage table for real-time cost tracking
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.ENDPOINT
});

// Plan budget limits
const PLAN_BUDGETS = {
  starter: 20.00,
  pro: 80.00,
  team: 180.00,
  agency: 480.00,
  enterprise: 980.00
};

module.exports = async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }
    
    // Get tenant's plan
    const tenant = await getTenant(tenantId);
    const plan = tenant?.plan || 'starter';
    const budgetLimit = PLAN_BUDGETS[plan] || PLAN_BUDGETS.starter;
    
    // Get current month's usage
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    const command = new QueryCommand({
      TableName: 'clawops-usage',
      KeyConditionExpression: 'tenantId = :tid AND #d >= :monthStart',
      ExpressionAttributeNames: {
        '#d': 'date'
      },
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
    const breakdown = {}; // Cost by provider
    const dailyCosts = {}; // Cost by day
    
    if (response.Items) {
      for (const item of response.Items) {
        const record = unmarshall(item);
        
        const cost = parseFloat(record.cost || 0);
        totalCost += cost;
        requestCount += 1;
        tokensIn += parseInt(record.tokensIn || 0);
        tokensOut += parseInt(record.tokensOut || 0);
        
        // By provider
        const provider = record.provider || 'unknown';
        breakdown[provider] = (breakdown[provider] || 0) + cost;
        
        // By day
        const day = record.timestamp.substring(0, 10); // YYYY-MM-DD
        dailyCosts[day] = (dailyCosts[day] || 0) + cost;
      }
    }
    
    // Today's cost
    const today = now.toISOString().substring(0, 10);
    const todayCost = dailyCosts[today] || 0;
    
    // Budget utilization
    const utilization = (totalCost / budgetLimit) * 100;
    const remaining = budgetLimit - totalCost;
    
    // Alert level
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
      usage: {
        totalCost,
        todayCost,
        requestCount,
        tokensIn,
        tokensOut
      },
      breakdown,
      dailyCosts: Object.entries(dailyCosts).map(([date, cost]) => ({
        date,
        cost
      })).sort((a, b) => a.date.localeCompare(b.date))
    });
    
  } catch (err) {
    console.error('Error getting usage:', err);
    res.status(500).json({ 
      error: 'Failed to get usage',
      message: err.message 
    });
  }
};

async function getTenant(tenantId) {
  const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
  
  try {
    const command = new GetItemCommand({
      TableName: 'clawops-tenants',
      Key: {
        tenantId: { S: tenantId }
      }
    });
    
    const response = await dynamodb.send(command);
    
    if (response.Item) {
      return unmarshall(response.Item);
    }
    
    return null;
  } catch (err) {
    console.error('Error getting tenant:', err);
    return null;
  }
}
