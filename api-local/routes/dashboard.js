/**
 * Dashboard Router — /api/dashboard/*
 * Auth matrix: ALL routes require requireAuth (session-based auth)
 *   ALL  /bots             — requireAuth (in handler via getEmailFromSession)
 *   ALL  /create-bot       — requireAuth (in handler)
 *   ALL  /bot-action       — requireBotOwnership (in handler)
 *   ALL  /rename-bot       — requireBotOwnership (in handler)
 *   ALL  /container-stats  — requireBotOwnership (in handler)
 *   ALL  /billing          — requireAuth (in handler)
 *   ALL  /usage            — requireAuth/requireBotOwnership (in handler)
 *   GET  /usage/:tenantId  — requireBotOwnership (in handler)
 *   ALL  /margin           — requireAuth (in handler via getEmailFromSession)
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

const base = path.join(__dirname, '..', 'dashboard');

router.use(async (req, res, next) => {
  const email = await requireAuth(req, res);
  if (!email) return;
  next();
});

router.all('/bots', wrapHandler(path.join(base, 'bots.js')));
router.all('/create-bot', wrapHandler(path.join(base, 'create-bot.js')));
router.all('/bot-action', wrapHandler(path.join(base, 'bot-action.js')));
router.all('/rename-bot', wrapHandler(path.join(base, 'rename-bot.js')));
router.all('/container-stats', wrapHandler(path.join(base, 'container-stats.js')));
router.all('/billing', wrapHandler(path.join(base, 'billing.js')));
router.all('/usage', wrapHandler(path.join(base, 'usage.js')));
router.get('/usage/:tenantId', wrapHandler(path.join(base, 'usage.js')));
router.all('/margin', wrapHandler(path.join(base, 'margin.js')));
router.all('/bots/:tenantId/secrets', wrapHandler(path.join(base, 'instance-secrets.js')));

module.exports = router;
