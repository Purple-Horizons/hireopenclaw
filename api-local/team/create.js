const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  })
});

const db = DynamoDBDocumentClient.from(client);

module.exports = async (req, res) => {
  try {
    const { name, plan = 'team' } = req.body;
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Team name required' });
    }

    // Generate team ID
    const teamId = `team-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Create team
    const team = {
      teamId,
      ownerId: userId,
      name,
      plan,
      seats: plan === 'team' ? 5 : plan === 'agency' ? 20 : 100,
      createdAt: Date.now(),
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
      email: req.session.email,
      role: 'owner',
      status: 'active',
      permissions: {
        createBots: true,
        deleteBots: true,
        viewBilling: true,
        manageTeam: true,
        manageBots: [] // empty = all access
      },
      joinedAt: Date.now()
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
