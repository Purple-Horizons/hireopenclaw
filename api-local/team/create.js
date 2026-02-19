const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');


module.exports = async (req, res) => {
  try {
    const { normalizePlan } = require('../billing/stripe-plans.js');
    const { name, plan: rawPlan } = req.body;
    const plan = normalizePlan(rawPlan) || 'starter';
    const userId = req.userEmail;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Team name required' });
    }

    // Generate team ID
    const teamId = `team-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const nowIso = new Date().toISOString();

    // Create team
    const team = {
      teamId,
      ownerId: userId,
      name,
      plan,
      seats: plan === 'starter' ? 1 : plan === 'pro' ? 3 : plan === 'business' ? 10 : 50,
      createdAt: nowIso,
      settings: {
        requireApproval: true
      }
    };

    await db.send(new PutCommand({
      TableName: 'clawops-teams',
      Item: team
    }));

    // Create owner membership
    const membershipId = `mem-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const membership = {
      membershipId,
      teamId,
      userId,
      email: req.userEmail,
      role: 'owner',
      status: 'active',
      permissions: {
        createBots: true,
        deleteBots: true,
        viewBilling: true,
        manageTeam: true,
        manageBots: [] // empty = all access
      },
      joinedAt: nowIso
    };

    await db.send(new PutCommand({
      TableName: 'clawops-team-members',
      Item: membership
    }));

    res.json({
      teamId,
      name,
      ownerId: userId,
      plan,
      seats: team.seats
    });

  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
};
