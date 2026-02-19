const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { ensureTeam, getTeamByOwner } = require('../auth/team-plan.js');
const { normalizePlan } = require('./stripe-plans.js');

const USAGE_POLICY_MODES = new Set(['notify_only', 'hard_cap', 'metered']);

function normalizeUsagePolicy(policy) {
  const mode = String(policy?.mode || '').trim().toLowerCase();
  return {
    mode: USAGE_POLICY_MODES.has(mode) ? mode : 'notify_only',
    updatedAt: policy?.updatedAt || null,
  };
}

async function updateTeamBillingByEmail(email, fields) {
  if (!email) return null;

  const normalizedPlan = fields.plan ? normalizePlan(fields.plan) : null;
  const seedPlan = normalizedPlan || 'starter';
  const team = await ensureTeam(email, seedPlan);
  if (!team?.teamId) return null;

  const updates = [];
  const values = {};
  const names = {};

  if (normalizedPlan) {
    updates.push('#plan = :plan');
    names['#plan'] = 'plan';
    values[':plan'] = normalizedPlan;
  }
  if (fields.stripeCustomerId !== undefined) {
    updates.push('stripeCustomerId = :stripeCustomerId');
    values[':stripeCustomerId'] = fields.stripeCustomerId;
  }
  if (fields.stripeSubscriptionId !== undefined) {
    updates.push('stripeSubscriptionId = :stripeSubscriptionId');
    values[':stripeSubscriptionId'] = fields.stripeSubscriptionId;
  }
  if (fields.billingStatus !== undefined) {
    updates.push('billingStatus = :billingStatus');
    values[':billingStatus'] = fields.billingStatus;
  }
  if (fields.currentPeriodEnd !== undefined) {
    updates.push('currentPeriodEnd = :currentPeriodEnd');
    values[':currentPeriodEnd'] = fields.currentPeriodEnd;
  }
  if (fields.pendingPlan !== undefined) {
    updates.push('pendingPlan = :pendingPlan');
    values[':pendingPlan'] = fields.pendingPlan;
  }
  if (fields.usagePolicy !== undefined) {
    updates.push('usagePolicy = :usagePolicy');
    values[':usagePolicy'] = normalizeUsagePolicy(fields.usagePolicy);
  }

  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TEAMS,
    Key: { teamId: team.teamId },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    ExpressionAttributeValues: values,
  }));

  return getTeamByOwner(email);
}

module.exports = {
  normalizeUsagePolicy,
  updateTeamBillingByEmail,
};
