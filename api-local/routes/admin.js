/**
 * Admin Router — /api/admin/*
 * Auth matrix: ALL routes require requireAdmin (admin-only access)
 *   GET  /clients           — requireAdmin (in handler)
 *   GET  /clients/:email    — requireAdmin (in handler)
 *   PATCH /clients/:email   — requireAdmin (in handler)
 *   GET  /clients/:email/team-members — requireAdmin (in handler)
 *   POST /clients/:email/team-members — requireAdmin (in handler)
 *   PATCH /clients/:email/team-members/:memberId — requireAdmin (in handler)
 *   DELETE /clients/:email/team-members/:memberId — requireAdmin (in handler)
 *   PATCH /clients/:email/tenants/:tenantId — requireAdmin (in handler)
 *   DELETE /clients/:email/tenants/:tenantId — requireAdmin (in handler)
 *   ALL  /bots/:tenantId    — requireAdmin (in handler)
 *   POST /bots/:tenantId/backup  — requireAdmin (in handler)
 *   GET  /bots/:tenantId/backups — requireAdmin (in handler)
 *   POST /bots/:tenantId/restore — requireAdmin (in handler)
 *   POST /impersonate       — requireAdmin (in handler)
 *   POST /stop-impersonate  — requireAdmin (in handler)
 *   ALL  /secrets           — requireAdmin (in handler)
 *   GET  /updates/version-catalog — requireAdmin (in handler)
 *   GET  /waitlist          — requireAdmin (in handler)
 *   POST /waitlist/activate — requireAdmin (in handler)
 *   POST /waitlist/reject   — requireAdmin (in handler)
 */
const router = require('express').Router();
const path = require('path');

const adminClients = require(path.join(__dirname, '..', 'admin', 'clients.js'));
const adminBots = require(path.join(__dirname, '..', 'admin', 'bots.js'));
const adminImpersonate = require(path.join(__dirname, '..', 'admin', 'impersonate.js'));
const { handleAdminBackup } = require(path.join(__dirname, '..', 'admin', 'backup.js'));
const { handleAdminSecrets } = require(path.join(__dirname, '..', 'admin', 'secrets.js'));
const adminUpdateVersionCatalog = require(path.join(__dirname, '..', 'admin', 'updates-version-catalog.js'));
const {
  handleAdminWaitlistList,
  handleAdminWaitlistActivate,
  handleAdminWaitlistReject,
} = require(path.join(__dirname, '..', 'admin', 'waitlist.js'));
const adminHealth = require(path.join(__dirname, '..', 'admin', 'health.js'));
const adminRevenue = require(path.join(__dirname, '..', 'admin', 'revenue.js'));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { console.error('[Admin Error]', err); res.status(500).json({ error: 'Internal error' }); }
};

router.get('/clients', wrap(adminClients));
router.get('/clients/:email', wrap(adminClients));
router.patch('/clients/:email', wrap(adminClients));
router.get('/clients/:email/team-members', wrap(adminClients));
router.post('/clients/:email/team-members', wrap(adminClients));
router.patch('/clients/:email/team-members/:memberId', wrap(adminClients));
router.delete('/clients/:email/team-members/:memberId', wrap(adminClients));
router.patch('/clients/:email/tenants/:tenantId', wrap(adminClients));
router.delete('/clients/:email/tenants/:tenantId', wrap(adminClients));
router.all('/bots/:tenantId', wrap(adminBots));
router.post('/bots/:tenantId/backup', wrap(handleAdminBackup));
router.get('/bots/:tenantId/backups', wrap(handleAdminBackup));
router.delete('/bots/:tenantId/backups/:backupId', wrap(handleAdminBackup));
router.post('/bots/:tenantId/restore', wrap(handleAdminBackup));
router.post('/impersonate', wrap(adminImpersonate));
router.post('/stop-impersonate', (req, res, next) => { req.path = '/stop'; next(); }, wrap(adminImpersonate));
router.all('/secrets', wrap(handleAdminSecrets));
router.get('/updates/version-catalog', wrap(adminUpdateVersionCatalog));
router.get('/waitlist', wrap(handleAdminWaitlistList));
router.post('/waitlist/activate', wrap(handleAdminWaitlistActivate));
router.post('/waitlist/reject', wrap(handleAdminWaitlistReject));
router.get('/health', wrap(adminHealth));
router.get('/revenue', wrap(adminRevenue));

module.exports = router;
