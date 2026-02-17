const router = require('express').Router();
const path = require('path');

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

router.all('/api-keys', wrapHandler(path.join(base, 'api-keys.js')));
router.all('/team', wrapHandler(path.join(base, 'team.js')));
router.all('/preferences', wrapHandler(path.join(base, 'preferences.js')));

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
