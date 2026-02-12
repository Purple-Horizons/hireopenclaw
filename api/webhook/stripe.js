// Vercel Serverless Function — Stripe Webhook
// POST /api/webhook/stripe
// Handles checkout.session.completed → triggers tenant provisioning

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const MASTERCONTROL_URL = process.env.MASTERCONTROL_URL; // e.g. https://clawops.purplehorizons.io/api
  const MASTERCONTROL_TOKEN = process.env.MASTERCONTROL_TOKEN;

  try {
    // TODO: Verify Stripe signature with STRIPE_WEBHOOK_SECRET
    // const sig = req.headers['stripe-signature'];
    // const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    const event = req.body;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name || '';
      const plan = session.metadata?.plan || 'starter';
      const template = session.metadata?.template || 'blank';
      const mode = session.metadata?.mode || 'managed';

      console.log(`[Stripe] New signup: ${customerEmail}, plan: ${plan}, template: ${template}`);

      // Determine model based on plan tier
      const modelByPlan = {
        starter: 'anthropic/claude-haiku-4-5',
        professional: 'anthropic/claude-sonnet-4-5',
        enterprise: 'anthropic/claude-opus-4-6'
      };
      const model = modelByPlan[plan] || 'anthropic/claude-haiku-4-5';

      // Store in Supabase (when connected)
      // const { data, error } = await supabase.from('tenants').insert({
      //   email: customerEmail, name: customerName, plan, template, mode,
      //   status: 'provisioning', stripe_session_id: session.id
      // });

      // Trigger MasterControl to provision tenant
      if (MASTERCONTROL_URL && MASTERCONTROL_TOKEN) {
        try {
          const provisionReq = await fetch(`${MASTERCONTROL_URL}/provision`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${MASTERCONTROL_TOKEN}`
            },
            body: JSON.stringify({
              email: customerEmail,
              name: customerName,
              plan,
              template,
              mode,
              model,
              stripeSessionId: session.id
            })
          });
          const result = await provisionReq.json();
          console.log(`[Stripe] Provision result:`, result);
        } catch (provErr) {
          console.error(`[Stripe] Provision failed:`, provErr.message);
          // TODO: Queue for retry or notify admin
        }
      } else {
        console.log(`[Stripe] MasterControl not configured — manual provision needed`);
        // Fallback: send notification email
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
            },
            body: JSON.stringify({
              from: 'ClawOps <noreply@purplehorizons.io>',
              to: 'g@purplehorizons.io',
              subject: `🚀 New ClawOps signup: ${customerEmail} (${plan})`,
              text: `New customer signed up!\n\nEmail: ${customerEmail}\nName: ${customerName}\nPlan: ${plan}\nTemplate: ${template}\nMode: ${mode}\nStripe Session: ${session.id}\n\nProvision manually via MasterControl.`
            })
          });
        } catch (emailErr) {
          console.error(`[Stripe] Email notification failed:`, emailErr.message);
        }
      }

      return res.status(200).json({ received: true, action: 'provision_triggered' });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      console.log(`[Stripe] Subscription cancelled:`, subscription.id);
      // TODO: Pause or terminate tenant
      return res.status(200).json({ received: true, action: 'subscription_cancelled' });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      console.log(`[Stripe] Payment failed:`, invoice.id);
      // TODO: Send warning, pause after 3 failures
      return res.status(200).json({ received: true, action: 'payment_failed' });
    }

    // Acknowledge unhandled events
    return res.status(200).json({ received: true, action: 'ignored' });

  } catch (error) {
    console.error('[Stripe] Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
