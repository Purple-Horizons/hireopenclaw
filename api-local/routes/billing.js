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

const base = path.join(__dirname, '..', '..', 'api-local', 'billing');

// Check if billing directory exists, fall back to dashboard billing
try {
  require(path.join(__dirname, '..', 'billing', 'checkout.js'));
  router.all('/checkout', wrapHandler(path.join(__dirname, '..', 'billing', 'checkout.js')));
  router.all('/webhook', wrapHandler(path.join(__dirname, '..', 'billing', 'webhook.js')));
} catch {
  // Billing handlers may be registered via apiRoutes in server.js
}

module.exports = router;
