/**
 * Session Validation API
 * POST /api/auth/session - Validate session token
 * DELETE /api/auth/session - Logout (invalidate session)
 */

// Shared token store
const sessionStore = require('./token-store.js');

module.exports = async (req, res) => {
  // Validate session
  if (req.method === 'POST') {
    const { sessionToken } = req.body || req.query;
    
    if (!sessionToken) {
      return res.status(400).json({ error: 'sessionToken is required' });
    }
    
    const sessionData = await sessionStore.get(sessionToken);
    
    if (!sessionData) {
      return res.status(401).json({ valid: false, error: 'Invalid session' });
    }
    
    if (sessionData.type !== 'session') {
      return res.status(401).json({ valid: false, error: 'Not a session token' });
    }
    
    if (sessionData.expiresAt < Date.now()) {
      sessionStore.delete(sessionToken);
      return res.status(401).json({ valid: false, error: 'Session expired' });
    }
    
    return res.status(200).json({
      valid: true,
      email: sessionData.email,
      expiresAt: sessionData.expiresAt
    });
  }
  
  // Logout
  if (req.method === 'DELETE') {
    const { sessionToken } = req.body || req.query;
    
    if (sessionToken) {
      sessionStore.delete(sessionToken);
    }
    
    return res.status(200).json({
      ok: true,
      message: 'Logged out'
    });
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};

// sessionStore is now imported from magic-link.js
