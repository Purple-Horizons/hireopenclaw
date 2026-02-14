const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { Resend } = require('resend');

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
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  try {
    const { teamId, email, role = 'member', permissions = {} } = req.body;
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!teamId || !email) {
      return res.status(400).json({ error: 'Team ID and email required' });
    }

    // 1. Verify requester is owner/admin
    const requesterMembership = await db.send(new QueryCommand({
      TableName: 'clawops-team-members',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'teamId = :teamId AND #status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':teamId': teamId,
        ':active': 'active'
      }
    }));

    if (!requesterMembership.Items?.length) {
      return res.status(403).json({ error: 'Not a team member' });
    }

    const requesterRole = requesterMembership.Items[0].role;
    if (!['owner', 'admin'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // 2. Get team to check seats
    const teamResult = await db.send(new GetCommand({
      TableName: 'clawops-teams',
      Key: { teamId }
    }));

    if (!teamResult.Item) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = teamResult.Item;

    // 3. Check seats available
    const existingMembers = await db.send(new QueryCommand({
      TableName: 'clawops-team-members',
      IndexName: 'teamId-index',
      KeyConditionExpression: 'teamId = :teamId',
      FilterExpression: '#status IN (:active, :pending)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':teamId': teamId,
        ':active': 'active',
        ':pending': 'pending'
      }
    }));

    if (existingMembers.Items.length >= team.seats) {
      return res.status(400).json({ error: 'No seats available' });
    }

    // 4. Check if already invited
    const existing = existingMembers.Items.find(m => m.email === email);
    if (existing) {
      return res.status(400).json({ error: 'User already invited or member' });
    }

    // 5. Create pending membership
    const membershipId = `mem-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

    const membership = {
      membershipId,
      teamId,
      userId: null, // will be set when accepted
      email,
      role,
      status: 'pending',
      permissions: {
        createBots: permissions.createBots !== false,
        deleteBots: permissions.deleteBots === true,
        viewBilling: permissions.viewBilling === true,
        manageTeam: role === 'admin',
        manageBots: permissions.manageBots || []
      },
      invitedAt: Date.now(),
      invitedBy: userId
    };

    await db.send(new PutCommand({
      TableName: 'clawops-team-members',
      Item: membership
    }));

    // 6. Store invite token
    await db.send(new PutCommand({
      TableName: 'clawops-auth-tokens',
      Item: {
        token,
        type: 'team_invite',
        membershipId,
        teamId,
        email,
        expires,
        ttl: Math.floor(expires / 1000)
      }
    }));

    // 7. Send invite email
    const inviteUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/invite#token=${token}`;
    
    try {
      await resend.emails.send({
        from: 'ClawOps <noreply@hireopenclaw.com>',
        to: email,
        subject: `You've been invited to join ${team.name} on ClawOps`,
        html: `
          <h2>You've been invited to join ${team.name}</h2>
          <p>You've been invited to join <strong>${team.name}</strong> on ClawOps as a <strong>${role}</strong>.</p>
          <p><a href="${inviteUrl}" style="background: #7C3AED; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Accept Invitation</a></p>
          <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
          <p style="color: #666; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
        `
      });
    } catch (emailError) {
      console.error('Email send failed:', emailError);
      // Don't fail the request if email fails in local dev
      if (!isLocal) {
        throw emailError;
      }
    }

    res.json({
      membershipId,
      status: 'pending',
      inviteUrl: isLocal ? inviteUrl : undefined // only return URL in local dev
    });

  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ error: 'Failed to invite member' });
  }
};
