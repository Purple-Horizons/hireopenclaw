/**
 * API Key Management
 * POST /api/settings/api-keys - Generate new API key
 * GET /api/settings/api-keys - List user's API keys
 * DELETE /api/settings/api-keys/:keyId - Revoke API key
 */

const crypto = require('crypto');
const { QueryCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { getEmailFromSession } = require('../auth/middleware.js');

function generateApiKey() {
  return 'clw_' + crypto.randomBytes(32).toString('hex');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

module.exports = async (req, res) => {
  const email = await getEmailFromSession(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Generate new API key
  if (req.method === 'POST') {
    const { name, scopes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const safeScopes = Array.isArray(scopes) && scopes.length
      ? scopes.filter((s) => typeof s === 'string' && s.trim())
      : ['read'];

    const apiKey = generateApiKey();
    const keyHash = hashKey(apiKey);
    const keyId = crypto.randomBytes(16).toString('hex');

    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.API_KEYS,
        Item: {
          keyId,
          email,
          keyHash,
          name: name.trim(),
          scopes: safeScopes,
          createdAt: new Date().toISOString(),
          lastUsed: null,
          active: true,
        },
      }));

      // Return the key ONCE (never shown again)
      return res.status(201).json({
        ok: true,
        keyId,
        apiKey,
        name: name.trim(),
        scopes: safeScopes,
        message: 'Save this key now - it won\'t be shown again!',
      });
    } catch (err) {
      console.error('Failed to create API key:', err);
      return res.status(500).json({ error: 'Failed to create API key' });
    }
  }

  // List API keys
  if (req.method === 'GET') {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.API_KEYS,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email,
        },
      }));

      const keys = (result.Items || [])
        .filter((item) => item.active !== false)
        .map((item) => ({
          keyId: item.keyId,
          name: item.name,
          scopes: item.scopes || [],
          createdAt: item.createdAt,
          lastUsed: item.lastUsed || null,
          active: item.active !== false,
          preview: `clw_${'•'.repeat(12)}${item.keyId?.slice(-4) || '••••'}`,
        }));

      return res.status(200).json({
        ok: true,
        keys,
      });
    } catch (err) {
      console.error('Failed to list API keys:', err);
      return res.status(500).json({ error: 'Failed to list API keys' });
    }
  }

  // Revoke API key
  if (req.method === 'DELETE') {
    const { keyId } = req.body || {};
    if (!keyId || typeof keyId !== 'string') {
      return res.status(400).json({ error: 'keyId is required' });
    }

    try {
      const existing = await docClient.send(new GetCommand({
        TableName: TABLES.API_KEYS,
        Key: { keyId },
      }));

      if (!existing.Item || existing.Item.email !== email) {
        return res.status(404).json({ error: 'API key not found' });
      }

      await docClient.send(new UpdateCommand({
        TableName: TABLES.API_KEYS,
        Key: { keyId },
        UpdateExpression: 'SET active = :active, revokedAt = :now',
        ExpressionAttributeValues: {
          ':active': false,
          ':now': new Date().toISOString(),
        },
      }));

      return res.status(200).json({
        ok: true,
        message: 'API key revoked',
      });
    } catch (err) {
      console.error('Failed to revoke API key:', err);
      return res.status(500).json({ error: 'Failed to revoke API key' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
