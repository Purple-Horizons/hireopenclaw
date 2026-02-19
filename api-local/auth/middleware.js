/**
 * Auth middleware for dashboard API endpoints
 * Validates session cookie and returns user email
 */

const tokenStore = require('./token-store.js');
const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { ERROR_CODES, apiError } = require('../util/error-codes.js');
const logger = require('../util/logger.js');

// Named constants (TASK-306)
const IMPERSONATION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

/**
 * Extract email from session cookie
 * Returns email string or null
 */
function getSessionTokenFromRequest(req) {
  // Cookie first, then Authorization bearer, then explicit body token.
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  let sessionToken = match ? match[1] : null;
  if (!sessionToken) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) sessionToken = auth.slice(7);
  }
  if (!sessionToken && req.body?.sessionToken) {
    sessionToken = req.body.sessionToken;
  }
  return sessionToken || null;
}

async function getEmailFromSession(req) {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) return null;
  const session = await tokenStore.get(sessionToken);
  if (!session || session.type !== 'session' || session.expiresAt < Date.now()) return null;
  return session.email;
}

/**
 * Require auth — returns 401 if not authenticated
 * Sets req.userEmail if authenticated
 */
async function requireAuth(req, res) {
  // Respect admin impersonation when present.
  const email = await getEffectiveEmail(req);
  if (!email) {
    res.status(ERROR_CODES.AUTH_REQUIRED.status).json(apiError(ERROR_CODES.AUTH_REQUIRED));
    return null;
  }
  req.userEmail = email;
  return email;
}

/**
 * Verify bot ownership — returns bot data or null (with error response)
 */
async function requireBotOwnership(req, res, botId) {
  const email = await requireAuth(req, res);
  if (!email) return null;
  
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: TABLES.TENANTS,
      Key: { tenantId: { S: botId } }
    }));
    if (!result.Item) {
      res.status(ERROR_CODES.ACCESS_DENIED.status).json(apiError(ERROR_CODES.ACCESS_DENIED));
      return null;
    }
    const bot = unmarshall(result.Item);
    if (bot.email !== email) {
      res.status(ERROR_CODES.ACCESS_DENIED.status).json(apiError(ERROR_CODES.ACCESS_DENIED));
      return null;
    }
    return bot;
  } catch (err) {
    logger.error('auth', 'Bot ownership check failed', { error: err.message });
    res.status(ERROR_CODES.INTERNAL.status).json(apiError(ERROR_CODES.INTERNAL));
    return null;
  }
}

// Admin allowlist
const ADMIN_EMAILS = new Set([
  'g@purplehorizons.io',
]);

function isAdmin(email) {
  return email && ADMIN_EMAILS.has(email.toLowerCase());
}

/**
 * Require admin auth — returns 403 if not admin
 */
async function requireAdmin(req, res) {
  // CLI bypass — local development only
  if (process.env.NODE_ENV !== 'production') {
    const cliSecret = req.headers['x-cli-secret'];
    const expectedSecret = process.env.CLI_SECRET;
    if (cliSecret && expectedSecret && cliSecret === expectedSecret) {
      logger.info('auth', 'CLI admin access', { ip: req.ip });
      req.userEmail = 'cli@localhost';
      req.isAdmin = true;
      req.isCLI = true;
      return 'cli@localhost';
    }
  }
  
  const email = await getEmailFromSession(req);
  if (!email) {
    res.status(ERROR_CODES.AUTH_REQUIRED.status).json(apiError(ERROR_CODES.AUTH_REQUIRED));
    return null;
  }
  if (!isAdmin(email)) {
    res.status(ERROR_CODES.ADMIN_REQUIRED.status).json(apiError(ERROR_CODES.ADMIN_REQUIRED));
    return null;
  }
  req.userEmail = email;
  req.isAdmin = true;
  return email;
}

/**
 * Get impersonated email (admin viewing as client)
 * Falls back to actual session email
 */
async function getEffectiveEmail(req) {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) return null;
  const session = await tokenStore.get(sessionToken);
  if (!session || session.type !== 'session' || session.expiresAt < Date.now()) return null;
  
  // If admin is impersonating, use impersonated email
  if (session.impersonating && isAdmin(session.email)) {
    // Check timeout (1 hour)
    if (session.impersonatedAt && Date.now() - session.impersonatedAt > IMPERSONATION_TIMEOUT_MS) {
      logger.info('auth', 'Impersonation expired', { admin: session.email, target: session.impersonating });
      delete session.impersonating;
      delete session.impersonatedAt;
      tokenStore.set(sessionToken, session);
      return session.email;
    }
    logger.info('auth', 'Admin impersonating', { admin: session.email, target: session.impersonating });
    return session.impersonating;
  }
  return session.email;
}

module.exports = { getSessionTokenFromRequest, getEmailFromSession, requireAuth, requireBotOwnership, isAdmin, requireAdmin, getEffectiveEmail, ADMIN_EMAILS };
