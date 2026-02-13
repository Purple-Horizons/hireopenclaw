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

  // For local dev, return mock billing data
  // TODO: Integrate with Stripe for real billing
  return res.status(200).json({
    plan: 'starter',
    status: 'active',
    billingCycle: 'monthly',
    nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    currentPeriod: {
      start: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    },
    usage: {
      tokensUsed: 123456,
      tokensLimit: 500000,
      percentUsed: 24.7
    },
    upcomingInvoice: {
      amount: 299,
      currency: 'usd',
      date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
};
