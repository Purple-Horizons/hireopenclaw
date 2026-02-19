/**
 * POST /api/billing/portal
 * Create a Stripe customer portal session for billing self-serve actions.
 */

const { requireAuth } = require('../auth/middleware.js');
const { getOrCreateStripeCustomerId } = require('./stripe-customer.js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const email = await requireAuth(req, res);
    if (!email) return;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const baseUrl = process.env.BASE_URL || process.env.SITE_URL || 'http://localhost:3000';

    if (!stripeKey) {
      return res.status(200).json({
        url: `${baseUrl}/dashboard?billing=mock-portal`,
        mode: 'development',
        message: 'Stripe not configured. Using mock billing portal URL.',
      });
    }

    const stripe = require('stripe')(stripeKey);
    const customerId = await getOrCreateStripeCustomerId(stripe, email);

    if (!customerId) {
      return res.status(404).json({ error: 'No billing customer found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/dashboard?tab=billing`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Billing portal error:', error);
    return res.status(500).json({ error: 'Failed to create billing portal session' });
  }
};
