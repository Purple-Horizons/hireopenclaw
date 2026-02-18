const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.userEmail;
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.TENANTS,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    }));

    const bots = result.Items || [];
    const summary = {
      totalBots: bots.length,
      activeBots: bots.filter((b) => b.status === 'active').length,
      pausedBots: bots.filter((b) => b.status === 'paused').length,
      provisioningBots: bots.filter((b) => b.status === 'provisioning').length,
      terminatedBots: bots.filter((b) => b.status === 'terminated').length,
    };

    return res.json({ ok: true, email, summary });
  } catch (error) {
    console.error('[Analytics Overview] Error:', error.message);
    return res.status(500).json({ error: 'Failed to load analytics overview' });
  }
};
