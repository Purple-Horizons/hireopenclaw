const router = require('express').Router();
const path = require('path');
const fs = require('fs');

const wrapHandler = (handlerPath) => async (req, res) => {
  try {
    const handler = require(handlerPath);
    await handler(req, res);
  } catch (err) {
    console.error(`[API Error] ${req.path}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const base = path.join(__dirname, '..', '..', 'api-local', 'billing');

const routes = [
  { route: '/checkout', handler: 'checkout.js' },
  { route: '/webhook', handler: 'webhook.js' },
  { route: '/portal', handler: 'portal.js' },
  { route: '/change-plan', handler: 'change-plan.js' },
  { route: '/usage-policy', handler: 'usage-policy.js' },
];

for (const entry of routes) {
  const handlerPath = path.join(base, entry.handler);
  if (!fs.existsSync(handlerPath)) continue;
  router.all(entry.route, wrapHandler(handlerPath));
}

module.exports = router;
