/**
 * Auth middleware for dashboard API endpoints
 * Validates session cookie and returns user email
 */

const tokenStore = require('./token-store.js');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

/**
 * Extract email from session cookie
 * Returns email string or null
 */
function getEmailFromSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  const sessionToken = match ? match[1] : null;
  if (!sessionToken) return null;
  const session = tokenStore.get(sessionToken);
  if (!session || session.type !== 'session' || session.expiresAt < Date.now()) return null;
  return session.email;
}

/**
 * Require auth — returns 401 if not authenticated
 * Sets req.userEmail if authenticated
 */
function requireAuth(req, res) {
  const email = getEmailFromSession(req);
  if (!email) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  req.userEmail = email;
  return email;
}

/**
 * Verify bot ownership — returns bot data or null (with error response)
 */
async function requireBotOwnership(req, res, botId) {
  const email = requireAuth(req, res);
  if (!email) return null;
  
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: process.env.DYNAMODB_TABLE || 'clawops-tenants',
      Key: { tenantId: { S: botId } }
    }));
    if (!result.Item) {
      res.status(403).json({ error: 'Bot not found or access denied' });
      return null;
    }
    const bot = unmarshall(result.Item);
    if (bot.email !== email) {
      res.status(403).json({ error: 'Bot not found or access denied' });
      return null;
    }
    return bot;
  } catch (err) {
    console.error('[Auth] Bot ownership check failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
    return null;
  }
}

module.exports = { getEmailFromSession, requireAuth, requireBotOwnership };
