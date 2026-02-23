/**
 * Settings Router — /api/settings/*
 * Auth matrix: ALL routes require requireAuth (session-based auth)
 *   ALL  /api-keys      — requireAuth (in handler via session check)
 *   ALL  /team          — requireAuth (in handler via session check)
 *   ALL  /preferences   — requireAuth (in handler via session check)
 *   ALL  /profile       — requireAuth (in handler via session check)
 *   ALL  /backup        — requireAuth (handleClientBackup checks session)
 *   POST /restore       — requireAuth (handleClientBackup checks session)
 *   ALL  /secrets       — requireAuth (handleClientSecrets checks session)
 */
const router = require('express').Router();
const path = require('path');
const { requireAuth } = require(path.join(__dirname, '..', 'auth', 'middleware.js'));

const wrapHandler = (handlerPath) => async (req, res) => {
  try {
    const handler = require(handlerPath);
    await handler(req, res);
  } catch (err) {
    console.error(`[API Error] ${req.path}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const base = path.join(__dirname, '..', 'settings');

router.use(async (req, res, next) => {
  const email = await requireAuth(req, res);
  if (!email) return;
  next();
});

router.all('/api-keys', wrapHandler(path.join(base, 'api-keys.js')));
router.all('/team', wrapHandler(path.join(base, 'team.js')));
router.all('/preferences', wrapHandler(path.join(base, 'preferences.js')));
router.all('/profile', wrapHandler(path.join(base, 'profile.js')));

// Backup/restore (settings context)
const { handleClientBackup } = require(path.join(__dirname, '..', 'admin', 'backup.js'));
const { handleClientSecrets } = require(path.join(__dirname, '..', 'admin', 'secrets.js'));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { console.error('[Settings Error]', err); res.status(500).json({ error: 'Internal error' }); }
};

router.all('/backup', wrap(handleClientBackup));
router.post('/restore', wrap(handleClientBackup));
router.all('/secrets', wrap(handleClientSecrets));

module.exports = router;
