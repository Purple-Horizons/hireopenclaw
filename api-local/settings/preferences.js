/**
 * User Preferences API
 * GET /api/settings/preferences - Get preferences
 * POST /api/settings/preferences - Save preferences
 */

const { GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');

const TABLE = TABLES.USER_PREFERENCES;

const DEFAULTS = {
  usageSpikeAlerts: true,
  weeklyReports: true,
  marketingEmails: false
};

const { getEmailFromSession } = require('../auth/middleware.js');

module.exports = async (req, res) => {
  const email = getEmailFromSession(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

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
