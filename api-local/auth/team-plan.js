/**
 * Team & Plan helpers — Single source of truth for user plan lookups
 * 
 * Plan lives on the TEAM, not on individual bots.
 * A user's plan determines: max bots, model access, usage limits.
 * 
 * TASK-300: Move plan from per-bot to per-user/team level
 */

const { QueryCommand, GetItemCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { PLAN_BOT_LIMITS, PLAN_TOKEN_LIMITS, VALID_PLANS } = require('../data/plans.js');

const TEAMS_TABLE = TABLES.TEAMS || 'clawops-teams';

/**
 * Get team by owner email (most common lookup)
 * Returns: { teamId, ownerId, plan, name, createdAt, ... } or null
 */
async function getTeamByOwner(email) {
  if (!email) return null;
  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TEAMS_TABLE,
      IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId = :email',
      ExpressionAttributeValues: { ':email': { S: email } },
      Limit: 1,
    }));
    if (result.Items && result.Items.length > 0) {
      return unmarshall(result.Items[0]);
    }
    return null;
  } catch (err) {
    console.error('[TeamPlan] getTeamByOwner failed:', err.message);
    return null;
  }
}

/**
 * Get user's plan (convenience wrapper)
 * Returns plan string ('starter', 'pro', etc.) or 'starter' as default
 */
async function getUserPlan(email) {
  const team = await getTeamByOwner(email);
  return team?.plan || 'starter';
}

/**
 * Get max bots allowed for a user
 */
async function getMaxBots(email) {
  const plan = await getUserPlan(email);
  return PLAN_BOT_LIMITS[plan] || 1;
}

/**
 * Check if user can create another bot
 * Returns: { allowed: boolean, reason?: string, current: number, max: number }
 */
async function canCreateBot(email) {
  const plan = await getUserPlan(email);
  const maxBots = PLAN_BOT_LIMITS[plan] || 1;

  // Count existing bots
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLES.TENANTS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } },
    Select: 'COUNT',
  }));
  const current = result.Count || 0;

  if (maxBots !== null && current >= maxBots) {
    return { allowed: false, reason: `${plan} plan allows ${maxBots} bot(s). Upgrade to add more.`, current, max: maxBots };
  }
  return { allowed: true, current, max: maxBots || Infinity };
}

/**
 * Check if a user/email exists (has a team record)
 * Used by magic-link login flow
 */
async function userExists(email) {
  const team = await getTeamByOwner(email);
  return !!team;
}

/**
 * Create a team for a new user (called during signup/first provision)
 * Returns the created team object
 */
async function createTeam(email, plan = 'starter', name = null) {
  const teamId = `team-${email.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
  const now = new Date().toISOString();

  const item = {
    teamId,
    ownerId: email,
    plan: VALID_PLANS.has(plan) ? plan : 'starter',
    name: name || email.split('@')[0],
    createdAt: now,
    updatedAt: now,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: TEAMS_TABLE,
    Item: marshall(item),
    ConditionExpression: 'attribute_not_exists(teamId)',
  }));

  console.log(`[TeamPlan] Created team ${teamId} for ${email} (${plan})`);
  return item;
}

/**
 * Update a team's plan
 */
async function updatePlan(email, newPlan) {
  const team = await getTeamByOwner(email);
  if (!team) throw new Error(`No team found for ${email}`);
  if (!VALID_PLANS.has(newPlan)) throw new Error(`Invalid plan: ${newPlan}`);

  await dynamodb.send(new UpdateItemCommand({
    TableName: TEAMS_TABLE,
    Key: { teamId: { S: team.teamId } },
    UpdateExpression: 'SET #plan = :plan, updatedAt = :now',
    ExpressionAttributeNames: { '#plan': 'plan' },
    ExpressionAttributeValues: {
      ':plan': { S: newPlan },
      ':now': { S: new Date().toISOString() },
    },
  }));

  console.log(`[TeamPlan] Updated ${email} plan: ${team.plan} → ${newPlan}`);
}

/**
 * Ensure team exists for email — creates if missing
 * Called during provision to auto-create team on first bot
 */
async function ensureTeam(email, plan = 'starter') {
  const existing = await getTeamByOwner(email);
  if (existing) return existing;
  try {
    return await createTeam(email, plan);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Race condition — team was created between check and create
      return await getTeamByOwner(email);
    }
    throw err;
  }
}

module.exports = {
  getTeamByOwner,
  getUserPlan,
  getMaxBots,
  canCreateBot,
  userExists,
  createTeam,
  updatePlan,
  ensureTeam,
};
