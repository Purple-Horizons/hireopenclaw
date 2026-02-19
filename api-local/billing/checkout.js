/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for initial subscription purchase.
 *
 * Supports both signed-in and onboarding flows:
 * - session email via auth middleware
 * - explicit body email for unauthenticated checkout
 */

const { getEmailFromSession } = require('../auth/middleware.js');
const {
  normalizePlan,
  getStripePriceIdForPlan,
  getPlanAmountCents,
  getPlanDisplayName,
  getCheckoutEligiblePlans,
} = require('./stripe-plans.js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const rawPlan = req.body?.plan;
    const plan = normalizePlan(rawPlan);
    const available = getCheckoutEligiblePlans();
    if (!plan || !available.includes(plan)) {
      return res.status(400).json({
        error: 'Invalid plan',
        available,
      });
    }

    const sessionEmail = await getEmailFromSession(req);
    const email = String(req.body?.email || sessionEmail || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Billing email is required' });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const baseUrl = process.env.BASE_URL || process.env.SITE_URL || 'http://localhost:3000';

    if (!stripeKey) {
      // Dev mode: return mock checkout URL so UX flows still work.
      return res.status(200).json({
        url: `${baseUrl}/success?plan=${encodeURIComponent(plan)}&mock_checkout=true`,
        sessionId: `cs_test_mock_${Date.now()}`,
        mode: 'development',
        message: 'Stripe not configured. Using mock checkout.',
      });
    }

    const stripe = require('stripe')(stripeKey);
    const stripePriceId = getStripePriceIdForPlan(plan);
    const amountCents = getPlanAmountCents(plan);
    const planName = getPlanDisplayName(plan) || plan;

    if (!stripePriceId && !amountCents) {
      return res.status(400).json({ error: `Plan ${plan} is not billable via checkout` });
    }

    const lineItems = stripePriceId
      ? [{ price: stripePriceId, quantity: 1 }]
      : [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `HireOpenClaw ${planName}`,
            description: `${planName} monthly subscription`,
          },
          unit_amount: amountCents,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: lineItems,
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing?canceled=true`,
      metadata: {
        plan,
        email,
        source: 'hireopenclaw',
      },
      subscription_data: {
        metadata: { plan, email },
      },
    });

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
