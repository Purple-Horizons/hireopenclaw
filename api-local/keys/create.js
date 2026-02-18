const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');


// Generate API key pair
function generateKeyPair(env = 'live') {
  const publicKey = `ck_${env}_${crypto.randomBytes(16).toString('hex')}`;
  const secretKey = `sk_${env}_${crypto.randomBytes(32).toString('hex')}`;
  return { publicKey, secretKey };
}

// Hash secret for storage
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

module.exports = async (req, res) => {
  try {
    const { name, scopes = [], rateLimit, expiresIn } = req.body;
    const userId = req.userEmail;
    const teamId = null;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Key name required' });
    }

    // Validate scopes
    const validScopes = [
      'bots:read',
      'bots:create',
      'bots:delete',
      'bots:manage',
      'usage:read',
      'team:read',
      'team:manage'
    ];

    const invalidScopes = scopes.filter(s => !validScopes.includes(s));
    if (invalidScopes.length) {
      return res.status(400).json({ 
        error: 'Invalid scopes', 
        invalid: invalidScopes,
        valid: validScopes
      });
    }

    // Generate keys
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const { publicKey, secretKey } = generateKeyPair(env);
    const keyId = `key-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Create API key record
    const apiKey = {
      keyId,
      userId,
      teamId: teamId || null,
      publicKey,
      hashedSecret: hashSecret(secretKey),
      name,
      scopes: scopes.length ? scopes : ['bots:read'], // default scope
      rateLimit: rateLimit || {
        requests: 1000,
        window: 3600 // 1 hour
      },
      status: 'active',
      createdAt: Date.now(),
      lastUsedAt: null,
      expiresAt: expiresIn ? Date.now() + (expiresIn * 1000) : null
    };

    await db.send(new PutCommand({
      TableName: 'clawops-api-keys',
      Item: apiKey
    }));

    // Return response (secret shown ONCE)
    res.json({
      keyId,
      publicKey,
      secretKey, // ⚠️ NEVER SHOWN AGAIN
      name,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
      warning: "Save this secret key now. You won't be able to see it again."
    });

  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
};
