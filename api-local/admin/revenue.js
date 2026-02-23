/**
 * Admin Revenue Dashboard API (PH-085)
 * GET /api/admin/revenue — MRR, cost per tenant, margin
 */

const { requireAdmin } = require('../auth/middleware.js');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { ScanCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { PLAN_PRICING } = require('../data/plans.js');

// Token cost rates (USD per million tokens)
const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = await requireAdmin(req, res);
  if (!email) return;

  try {
    // Get all teams
    const teamsResult = await dynamodb.send(new ScanCommand({
      TableName: TABLES.TEAMS,
      Limit: 100,
    }));
    const teams = (teamsResult.Items || []).map(unmarshall);

    // Get current month usage for all tenants
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const tenantsResult = await dynamodb.send(new ScanCommand({
      TableName: TABLES.TENANTS,
      Limit: 100,
    }));
    const tenants = (tenantsResult.Items || []).map(unmarshall);

    // Build tenant breakdown
    const breakdown = [];
    let totalMRR = 0;
    let totalCost = 0;

    for (const team of teams) {
      const plan = team.plan || 'starter';
      const planPrice = PLAN_PRICING[plan]?.price || 0;
      const ownerEmail = team.ownerEmail || team.email || '';

      // Find tenants for this team
      const teamTenants = tenants.filter(t => t.email === ownerEmail && t.status !== 'terminated');
      let teamTokens = 0;
      let teamInputTokens = 0;
      let teamOutputTokens = 0;

      for (const tenant of teamTenants) {
        try {
          const usageResult = await dynamodb.send(new QueryCommand({
            TableName: TABLES.USAGE,
            KeyConditionExpression: 'tenantId = :tid AND #d >= :start',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: {
              ':tid': { S: tenant.tenantId },
              ':start': { S: monthStart },
            },
            Limit: 1000,
          }));

          for (const raw of (usageResult.Items || [])) {
            const item = unmarshall(raw);
            const input = Number(item.inputTokens || 0);
            const output = Number(item.outputTokens || 0);
            teamInputTokens += input;
            teamOutputTokens += output;
            teamTokens += input + output;
          }
        } catch (err) {
          // Skip tenant usage on error
        }
      }

      const estimatedCost = ((teamInputTokens / 1_000_000) * INPUT_COST_PER_M) +
                            ((teamOutputTokens / 1_000_000) * OUTPUT_COST_PER_M);
      const margin = typeof planPrice === 'number' ? planPrice - estimatedCost : null;

      totalMRR += typeof planPrice === 'number' ? planPrice : 0;
      totalCost += estimatedCost;

      breakdown.push({
        teamId: team.teamId,
        email: ownerEmail,
        plan,
        planPrice: typeof planPrice === 'number' ? planPrice : null,
        bots: teamTenants.length,
        tokenUsage: teamTokens,
        inputTokens: teamInputTokens,
        outputTokens: teamOutputTokens,
        estimatedCost: Math.round(estimatedCost * 100) / 100,
        margin: margin !== null ? Math.round(margin * 100) / 100 : null,
      });
    }

    const totalMargin = totalMRR - totalCost;
    const marginPercent = totalMRR > 0 ? Math.round((totalMargin / totalMRR) * 10000) / 100 : 0;

    return res.status(200).json({
      mrr: Math.round(totalMRR * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      margin: Math.round(totalMargin * 100) / 100,
      marginPercent,
      totalTeams: teams.length,
      totalBots: tenants.filter(t => t.status !== 'terminated').length,
      breakdown,
      period: { start: monthStart, end: now.toISOString().slice(0, 10) },
      rates: { inputPerM: INPUT_COST_PER_M, outputPerM: OUTPUT_COST_PER_M },
    });
  } catch (err) {
    console.error('[Revenue] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch revenue data' });
  }
};
