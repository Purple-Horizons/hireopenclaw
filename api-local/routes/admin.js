const router = require('express').Router();
const path = require('path');

const adminClients = require(path.join(__dirname, '..', 'admin', 'clients.js'));
const adminBots = require(path.join(__dirname, '..', 'admin', 'bots.js'));
const adminImpersonate = require(path.join(__dirname, '..', 'admin', 'impersonate.js'));
const { handleAdminBackup } = require(path.join(__dirname, '..', 'admin', 'backup.js'));
const { handleAdminSecrets } = require(path.join(__dirname, '..', 'admin', 'secrets.js'));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { console.error('[Admin Error]', err); res.status(500).json({ error: 'Internal error' }); }
};

router.get('/clients', wrap(adminClients));
router.get('/clients/:email', wrap(adminClients));
router.all('/bots/:tenantId', wrap(adminBots));
router.post('/bots/:tenantId/backup', wrap(handleAdminBackup));
router.get('/bots/:tenantId/backups', wrap(handleAdminBackup));
router.post('/bots/:tenantId/restore', wrap(handleAdminBackup));
router.post('/impersonate', wrap(adminImpersonate));
router.post('/stop-impersonate', (req, res, next) => { req.path = '/stop'; next(); }, wrap(adminImpersonate));
router.all('/secrets', wrap(handleAdminSecrets));

module.exports = router;
