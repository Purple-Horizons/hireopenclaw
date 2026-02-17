/**
 * Instance Secrets Management — Per-bot secrets
 * 
 * Scope format: "instance:<tenantId>"
 * 
 * Routes:
 *   GET    /api/dashboard/bots/:tenantId/secrets  → list instance secrets
 *   POST   /api/dashboard/bots/:tenantId/secrets  → set instance secret
 *   DELETE /api/dashboard/bots/:tenantId/secrets  → delete instance secret
 * 
 * Auth: session cookie + bot ownership validation
 */

const { getEmailFromSession } = require('../auth/middleware.js');
const { listSecrets, setSecret, deleteSecret } = require('../admin/secrets.js');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../util/dynamodb.js');

// Validate tenantId format (alphanumeric, hyphens, underscores only)
function isValidTenantId(tenantId) {
  return /^[a-zA-Z0-9_-]+$/.test(tenantId);
}

// Verify user owns this bot
async function verifyBotOwnership(email, tenantId) {
  const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';
  
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email
    }
  }));

  const bots = result.Items || [];
  return bots.some(bot => bot.tenantId === tenantId);
}

module.exports = async (req, res) => {
  const email = await getEmailFromSession(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized — no valid session' });
  }

  const { tenantId } = req.params;
  
  if (!tenantId || !isValidTenantId(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId format' });
  }

  // Verify ownership
  try {
    const isOwner = await verifyBotOwnership(email, tenantId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Bot not found or access denied' });
    }
  } catch (err) {
    console.error('[Instance Secrets] Ownership check failed:', err);
    return res.status(500).json({ error: 'Failed to verify bot ownership' });
  }

  const scope = `instance:${tenantId}`;

  // GET — list instance secrets
  if (req.method === 'GET') {
    try {
      const secrets = await listSecrets(scope);
      return res.json({ ok: true, scope, secrets });
    } catch (err) {
      console.error('[Instance Secrets] List failed:', err);
      return res.status(500).json({ error: 'Failed to list secrets' });
    }
  }

  // POST — set instance secret
  if (req.method === 'POST') {
    const { key, value, label } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'key and value required' });
    }

    try {
      await setSecret(scope, key, value, label, email);
      console.log(`[Instance Secrets] ${email} set ${scope}/${key}`);
      return res.json({ ok: true, message: `Secret ${key} saved` });
    } catch (err) {
      console.error('[Instance Secrets] Set failed:', err);
      return res.status(500).json({ error: 'Failed to save secret' });
    }
  }

  // DELETE — delete instance secret
  if (req.method === 'DELETE') {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'key required' });
    }

    try {
      await deleteSecret(scope, key);
      console.log(`[Instance Secrets] ${email} deleted ${scope}/${key}`);
      return res.json({ ok: true, message: `Secret ${key} deleted` });
    } catch (err) {
      console.error('[Instance Secrets] Delete failed:', err);
      return res.status(500).json({ error: 'Failed to delete secret' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
