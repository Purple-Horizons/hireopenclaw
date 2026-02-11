// Vercel Serverless Function - Stripe Customer Portal
// POST /api/dashboard/billing

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Find Stripe customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });
    
    if (customers.data.length === 0) {
      return res.status(404).json({ error: 'No billing account found for this email' });
    }

    // Create customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: `${process.env.SITE_URL || 'https://hireopenclaw.com'}/dashboard`
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Billing portal error:', error);
    return res.status(500).json({ error: error.message });
  }
}
