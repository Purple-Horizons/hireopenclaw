// Vercel Serverless Function - Stripe Checkout
// Creates checkout session for ClawOps plans

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  // Price IDs - set these in Stripe Dashboard, then add to Vercel env
  const PRICES = {
    starter: process.env.STRIPE_PRICE_STARTER,         // $299/mo
    professional: process.env.STRIPE_PRICE_PROFESSIONAL, // $799/mo
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,     // custom
    setup: process.env.STRIPE_PRICE_SETUP               // one-time (optional)
  };

  try {
    const { plan, email, includeSetup } = req.body;

    if (!plan || !PRICES[plan]) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const lineItems = [
      {
        price: PRICES[plan],
        quantity: 1
      }
    ];

    // Add setup fee if not waived
    if (includeSetup && PRICES.setup) {
      lineItems.push({
        price: PRICES.setup,
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: email || undefined,
      success_url: `${process.env.SITE_URL || 'https://clawops.com'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL || 'https://clawops.com'}?canceled=true`,
      metadata: {
        plan: plan,
        source: 'clawops'
      },
      subscription_data: {
        metadata: {
          plan: plan
        }
      }
    });

    return res.status(200).json({ 
      url: session.url,
      sessionId: session.id 
    });

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ error: error.message });
  }
}
