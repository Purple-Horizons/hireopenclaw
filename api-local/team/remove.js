const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  })
});
const db = DynamoDBDocumentClient.from(client);

module.exports = async (req, res) => {
  try {
    const { teamId, membershipId } = req.body;
    const userId = req.session?.userId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!teamId || !membershipId) {
      return res.status(400).json({ error: 'teamId and membershipId required' });
    }

    // Verify requester is owner/admin
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

    const requesterRole = requester.Items[0].role;
    if (!['owner', 'admin'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Only owners and admins can remove members' });
    }

    // Get the target membership
    const target = await db.send(new GetCommand({
      TableName: 'clawops-team-members',
      Key: { membershipId }
    }));

    if (!target.Item) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Can't remove owner
    if (target.Item.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove team owner' });
    }

    // Admins can't remove other admins
    if (requesterRole === 'admin' && target.Item.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot remove other admins' });
    }

    // Revoke membership
    await db.send(new UpdateCommand({
      TableName: 'clawops-team-members',
      Key: { membershipId },
      UpdateExpression: 'SET #s = :revoked, revokedAt = :now, revokedBy = :by',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':revoked': 'revoked',
        ':now': Date.now(),
        ':by': userId
      }
    }));

    res.json({
      success: true,
      message: `Member ${target.Item.email} removed from team`
    });

  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};
