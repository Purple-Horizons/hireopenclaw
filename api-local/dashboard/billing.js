/**
 * Billing API - LocalStack Version
 * GET /api/dashboard/billing?email=user@example.com
 */

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email parameter required' });
  }

  const { PLAN_PRICING, PLAN_TOKEN_LIMITS } = require('../data/plans.js');
  const PLANS = {};
  for (const [k, v] of Object.entries(PLAN_PRICING)) {
    PLANS[k] = { price: v.price, tokens: PLAN_TOKEN_LIMITS[k], maxBots: v.maxBots };
  }

  // TODO: Fetch real plan from user record / Stripe
  const plan = 'starter';
  const planInfo = PLANS[plan];

  return res.status(200).json({
    plan,
    planPrice: planInfo.price,
    status: 'active',
    billingCycle: 'monthly',
    nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    currentPeriod: {
      start: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    },
    usage: {
      tokensUsed: 0,
      tokensLimit: planInfo.tokens,
      percentUsed: 0
    },
    upcomingInvoice: {
      amount: planInfo.price * 100, // cents
      currency: 'usd',
      date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
};
