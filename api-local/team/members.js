

const { QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');
const { validateTenantId } = require('../util/validate.js');

module.exports = async (req, res) => {
  try {
    const userId = req.userEmail;
    const teamId = req.query.teamId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!teamId) return res.status(400).json({ error: 'teamId required' });
    if (!validateTenantId(teamId)) return res.status(400).json({ error: 'Invalid teamId format' });

    // Verify requester is a member
    const requester = await db.send(new QueryCommand({
      TableName: 'clawops-team-members',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'teamId = :teamId AND #s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':teamId': teamId,
        ':active': 'active'
      }
    }));

    if (!requester.Items?.length) {
      return res.status(403).json({ error: 'Not a team member' });
    }

    // Get team info
    const team = await db.send(new GetCommand({
      TableName: 'clawops-teams',
      Key: { teamId }
    }));

    // Get all members
    const members = await db.send(new QueryCommand({
      TableName: 'clawops-team-members',
      IndexName: 'teamId-index',
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId }
    }));

    const active = members.Items.filter(m => m.status === 'active');
    const pending = members.Items.filter(m => m.status === 'pending');

    res.json({
      team: {
        teamId,
        name: team.Item?.name || 'Unknown',
        plan: team.Item?.plan || 'team',
        seats: team.Item?.seats || 5,
        seatsUsed: active.length + pending.length
      },
      members: active.map(m => ({
        membershipId: m.membershipId,
        email: m.email,
        role: m.role,
        status: m.status,
        permissions: m.permissions,
        joinedAt: m.joinedAt
      })),
      pending: pending.map(m => ({
        membershipId: m.membershipId,
        email: m.email,
        role: m.role,
        invitedAt: m.invitedAt,
        invitedBy: m.invitedBy
      }))
    });

  } catch (error) {
    console.error('List members error:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
};
