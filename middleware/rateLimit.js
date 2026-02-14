const crypto = require('crypto');

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

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

    // Get API key from database (mocked here, implement with DynamoDB)
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

    if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'API key expired'
      });
    }

    // Check rate limit
    const { requests, window } = apiKey.rateLimit;
    const key = `ratelimit:${apiKey.keyId}`;
    const now = Date.now();

    let limitData = rateLimitStore.get(key);
    
    if (!limitData || limitData.resetAt < now) {
      // Start new window
      limitData = {
        count: 0,
        resetAt: now + (window * 1000)
      };
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
    req.userId = apiKey.userId;
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
 * Get API key by hashed secret (implement with DynamoDB)
 */
async function getApiKeyByHash(hashedSecret) {
  // TODO: Query DynamoDB
  // For now, return mock data for testing
  return null;
}

/**
 * Update last used timestamp
 */
async function updateLastUsed(keyId) {
  // TODO: Update DynamoDB
  // UpdateCommand with lastUsedAt = Date.now()
}

module.exports = rateLimitMiddleware;
