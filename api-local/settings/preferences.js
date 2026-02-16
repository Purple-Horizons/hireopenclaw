/**
 * User Preferences API
 * GET /api/settings/preferences - Get preferences
 * POST /api/settings/preferences - Save preferences
 */

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

const TABLE = 'clawops-user-preferences';

const DEFAULTS = {
  usageSpikeAlerts: true,
  weeklyReports: true,
  marketingEmails: false
};

module.exports = async (req, res) => {
  const tokenStore = require('../auth/token-store.js');
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  const sessionToken = match ? match[1] : null;
  if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
  const session = tokenStore.get(sessionToken);
  if (!session || session.type !== 'session' || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const email = session.email;

  if (req.method === 'GET') {
    try {
      const result = await dynamodb.send(new GetItemCommand({
        TableName: TABLE,
        Key: { email: { S: email } }
      }));

      if (!result.Item) {
        return res.json({ ok: true, preferences: DEFAULTS });
      }

      const prefs = {
        usageSpikeAlerts: result.Item.usageSpikeAlerts?.BOOL ?? DEFAULTS.usageSpikeAlerts,
        weeklyReports: result.Item.weeklyReports?.BOOL ?? DEFAULTS.weeklyReports,
        marketingEmails: result.Item.marketingEmails?.BOOL ?? DEFAULTS.marketingEmails
      };
      return res.json({ ok: true, preferences: prefs });
    } catch (err) {
      console.error('[Preferences] GET error:', err.message);
      return res.json({ ok: true, preferences: DEFAULTS });
    }
  }

  if (req.method === 'POST') {
    const { usageSpikeAlerts, weeklyReports, marketingEmails } = req.body || {};

    try {
      await dynamodb.send(new PutItemCommand({
        TableName: TABLE,
        Item: {
          email: { S: email },
          usageSpikeAlerts: { BOOL: !!usageSpikeAlerts },
          weeklyReports: { BOOL: !!weeklyReports },
          marketingEmails: { BOOL: !!marketingEmails },
          updatedAt: { S: new Date().toISOString() }
        }
      }));
      return res.json({ ok: true, message: 'Preferences saved' });
    } catch (err) {
      console.error('[Preferences] POST error:', err.message);
      return res.status(500).json({ error: 'Failed to save preferences' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
