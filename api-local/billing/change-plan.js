/**
 * POST /api/billing/change-plan
 * Change subscription plan from dashboard.
 */

const { requireAuth } = require('../auth/middleware.js');
const { getTeamByOwner } = require('../auth/team-plan.js');
const { getOrCreateStripeCustomerId } = require('./stripe-customer.js');
const { updateTeamBillingByEmail } = require('./team-billing.js');
const {
  normalizePlan,
  getStripePriceIdForPlan,
} = require('./stripe-plans.js');

const PLAN_RANK = {
  free: 0,
  starter: 1,
  pro: 2,
  business: 3,
  enterprise: 4,
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const email = await requireAuth(req, res);
    if (!email) return;

    const requestedPlan = normalizePlan(req.body?.plan);
    if (!requestedPlan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (requestedPlan === 'free' || requestedPlan === 'enterprise') {
      return res.status(400).json({ error: 'Selected plan cannot be self-served in dashboard' });
    }

    const team = await getTeamByOwner(email);
    const currentPlan = normalizePlan(team?.plan) || 'starter';
    if (currentPlan === requestedPlan) {
      return res.status(200).json({
        ok: true,
        unchanged: true,
        plan: currentPlan,
        message: 'Already on this plan',
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const baseUrl = process.env.BASE_URL || process.env.SITE_URL || 'http://localhost:3000';

    // No Stripe key: simulate end-to-end by updating team plan.
    if (!stripeKey) {
      await updateTeamBillingByEmail(email, { plan: requestedPlan, billingStatus: 'active' });
      return res.status(200).json({
        ok: true,
        mode: 'development',
        previousPlan: currentPlan,
        plan: requestedPlan,
        message: 'Stripe not configured. Simulated plan change applied locally.',
      });
    }

    const stripe = require('stripe')(stripeKey);
    const customerId = await getOrCreateStripeCustomerId(stripe, email);
    if (!customerId) {
      return res.status(404).json({ error: 'No Stripe customer found' });
    }

    const requestedRank = PLAN_RANK[requestedPlan] || 0;
    const currentRank = PLAN_RANK[currentPlan] || 0;
    const isDowngrade = requestedRank < currentRank;

    if (isDowngrade && req.body?.applyAt !== 'immediate') {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/dashboard?tab=billing`,
      });
      return res.status(200).json({
        ok: true,
        requiresPortal: true,
        url: portalSession.url,
        message: 'Downgrades are handled in Stripe Billing Portal to preserve current-period access.',
      });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });
    const subscription = pickSubscription(subscriptions?.data || []);
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found for customer' });
    }

    const priceId = getStripePriceIdForPlan(requestedPlan);
    if (!priceId) {
      return res.status(400).json({ error: `Stripe price is not configured for plan ${requestedPlan}` });
    }
    const item = subscription.items?.data?.[0];
    if (!item?.id) {
      return res.status(500).json({ error: 'Subscription has no billable line item' });
    }

    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: isDowngrade ? 'none' : 'create_prorations',
      metadata: {
        ...(subscription.metadata || {}),
        plan: requestedPlan,
      },
    });

    await updateTeamBillingByEmail(email, {
      plan: requestedPlan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: updated.id,
      billingStatus: updated.status,
      currentPeriodEnd: updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null,
    });

    return res.status(200).json({
      ok: true,
      previousPlan: currentPlan,
      plan: requestedPlan,
      billingStatus: updated.status,
      effectiveAt: 'immediate',
    });
  } catch (error) {
    console.error('Change plan error:', error);
    return res.status(500).json({ error: 'Failed to change plan' });
  }
};

function pickSubscription(subscriptions) {
  if (!Array.isArray(subscriptions) || !subscriptions.length) return null;
  const preferred = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];
  for (const status of preferred) {
    const match = subscriptions.find((sub) => sub.status === status);
    if (match) return match;
  }
  return subscriptions[0];
}
