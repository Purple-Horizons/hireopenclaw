const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';
const client = new DynamoDBClient({
  region: 'us-east-1',
  ...(isLocal && {
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  })
});
const db = DynamoDBDocumentClient.from(client);

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map();

// In-memory API key cache (TTL 5 min)
const keyCache = new Map();
const KEY_CACHE_TTL = 5 * 60 * 1000;

// Clean up expired entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetAt < now) rateLimitStore.delete(key);
  }
  for (const [key, data] of keyCache.entries()) {
    if (data.cachedAt + KEY_CACHE_TTL < now) keyCache.delete(key);
  }
}, 5 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

/**
 * Rate limit middleware
 * Checks API key and enforces rate limits
 */
async function rateLimitMiddleware(req, res, next) {
  try {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'API key required. Use: Authorization: Bearer sk_...'
      });
    }

    const secretKey = authHeader.replace('Bearer ', '').trim();
    
    // Hash the secret to find the key record
    const hashedSecret = crypto.createHash('sha256').update(secretKey).digest('hex');

    // Get API key from database (with caching)
    const apiKey = await getApiKeyByHash(hashedSecret);

    if (!apiKey) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
    }

    if (apiKey.status !== 'active') {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'API key revoked'
      });
    }

    const expiresAtMs = toEpochMs(apiKey.expiresAt);
    if (expiresAtMs && expiresAtMs < Date.now()) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'API key expired'
      });
    }

    // Check rate limit
    const rateLimit = apiKey.rateLimit || { requests: 1000, window: 3600 };
    const { requests, window } = rateLimit;
    const key = `ratelimit:${apiKey.keyId}`;
    const now = Date.now();

    let limitData = rateLimitStore.get(key);
    
    if (!limitData || limitData.resetAt < now) {
      limitData = { count: 0, resetAt: now + (window * 1000) };
      rateLimitStore.set(key, limitData);
    }

    limitData.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', requests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, requests - limitData.count));
    res.setHeader('X-RateLimit-Reset', Math.floor(limitData.resetAt / 1000));

    if (limitData.count > requests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit: ${requests} per ${window}s`,
        retryAfter: Math.ceil((limitData.resetAt - now) / 1000)
      });
    }

    // Attach API key data to request
    req.apiKey = apiKey;
    req.userId = apiKey.userId || apiKey.email;
    req.teamId = apiKey.teamId;

    // Update last used timestamp (async, don't block)
    updateLastUsed(apiKey.keyId).catch(console.error);

    next();

  } catch (error) {
    console.error('Rate limit middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get API key by hashed secret from DynamoDB (with cache)
 */
async function getApiKeyByHash(hashedSecret) {
  // Check cache first
  const cached = keyCache.get(hashedSecret);
  if (cached && cached.cachedAt + KEY_CACHE_TTL > Date.now()) {
    return cached.key;
  }

  try {
    // Scan for matching hash (in production, use a GSI on hashedSecret)
    const result = await db.send(new ScanCommand({
      TableName: 'clawops-api-keys',
      FilterExpression: 'hashedSecret = :hash',
      ExpressionAttributeValues: { ':hash': hashedSecret }
    }));

    const key = result.Items?.[0] || null;
    
    // Cache result
    keyCache.set(hashedSecret, { key, cachedAt: Date.now() });
    
    return key;
  } catch (error) {
    console.error('DynamoDB key lookup error:', error);
    return null;
  }
}

/**
 * Update last used timestamp
 */
async function updateLastUsed(keyId) {
  try {
    await db.send(new UpdateCommand({
      TableName: 'clawops-api-keys',
      Key: { keyId },
      UpdateExpression: 'SET lastUsedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() }
    }));
  } catch (error) {
    console.error('Update lastUsedAt error:', error);
  }
}

function toEpochMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

module.exports = rateLimitMiddleware;
