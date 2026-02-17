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

router.all('/magic-link', wrapHandler(path.join(__dirname, '..', 'auth', 'magic-link.js')));
router.all('/session', wrapHandler(path.join(__dirname, '..', 'auth', 'session.js')));

module.exports = router;
