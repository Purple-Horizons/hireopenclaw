/**
 * Admin API — Impersonate Client
 * POST /api/admin/impersonate — Start impersonating a client
 * POST /api/admin/stop-impersonate — Stop impersonating
 */

const { requireAdmin, isAdmin } = require('../auth/middleware.js');
const tokenStore = require('../auth/token-store.js');

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const action = req.path.includes('stop') ? 'stop' : 'start';

  // Get session token
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  const sessionToken = match ? match[1] : null;

  if (!sessionToken) {
    return res.status(401).json({ error: 'No session' });
  }

  const session = await tokenStore.get(sessionToken);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  if (action === 'start') {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    // Set impersonation with timestamp for timeout
    session.impersonating = email;
    session.impersonatedAt = Date.now();
    tokenStore.set(sessionToken, session);

    console.log(`[Admin] ${admin} started impersonating ${email}`);
    return res.json({ ok: true, impersonating: email });
  }

  if (action === 'stop') {
    const was = session.impersonating;
    delete session.impersonating;
    delete session.impersonatedAt;
    tokenStore.set(sessionToken, session);

    console.log(`[Admin] ${admin} stopped impersonating ${was}`);
    return res.json({ ok: true, stopped: true });
  }
};
