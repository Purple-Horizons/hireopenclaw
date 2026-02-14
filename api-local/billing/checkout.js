/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for plan upgrade
 * 
 * Requires STRIPE_SECRET_KEY env var
 */

const PLANS = {
  starter: { priceId: null, amount: 2900, name: 'Starter' },    // $29/mo
  pro:     { priceId: null, amount: 9900, name: 'Pro' },         // $99/mo
  team:    { priceId: null, amount: 19900, name: 'Team' },       // $199/mo
  agency:  { priceId: null, amount: 49900, name: 'Agency' },     // $499/mo
  enterprise: { priceId: null, amount: 99900, name: 'Enterprise' } // $999/mo
};

module.exports = async (req, res) => {
  try {
    const { plan, email } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ 
        error: 'Invalid plan',
        available: Object.keys(PLANS)
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      // Dev mode: return mock checkout URL
      return res.json({
        url: `http://localhost:3000/checkout-success?plan=${plan}&email=${email}`,
        sessionId: `cs_test_mock_${Date.now()}`,
        mode: 'development',
        message: 'Stripe not configured. Using mock checkout.'
      });
    }

    // Production: create real Stripe session
    const stripe = require('stripe')(stripeKey);
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `ClawOps ${PLANS[plan].name} Plan`,
            description: `AI Employee Management - ${PLANS[plan].name}`
          },
          unit_amount: PLANS[plan].amount,
          recurring: {
            interval: 'month'
          }
        },
        quantity: 1
      }],
      success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard?cancelled=true`,
      metadata: {
        email,
        plan
      }
    });

    res.json({
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
