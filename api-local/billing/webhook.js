/**
 * POST /api/billing/webhook
 * Stripe webhook handler
 * 
 * Events handled:
 * - checkout.session.completed → Activate subscription
 * - customer.subscription.updated → Plan changes
 * - customer.subscription.deleted → Cancellation
 * - invoice.paid → Record payment
 * - invoice.payment_failed → Alert
 */


module.exports = async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    if (stripeKey && webhookSecret) {
      // Production: verify webhook signature
      const stripe = require('stripe')(stripeKey);
const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');
      const sig = req.headers['stripe-signature'];
      
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } else {
      // Dev mode: accept raw event
      event = req.body;
    }

    console.log(`[Stripe Webhook] ${event.type}`, event.data?.object?.id);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.metadata?.email || session.customer_email;
        const plan = session.metadata?.plan || 'starter';
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Update user with Stripe IDs
        const users = await db.send(new ScanCommand({
          TableName: 'clawops-tenants',
          FilterExpression: 'email = :email',
          ExpressionAttributeValues: { ':email': email }
        }));

        for (const user of (users.Items || [])) {
          await db.send(new UpdateCommand({
            TableName: 'clawops-tenants',
            Key: { tenantId: user.tenantId },
            UpdateExpression: 'SET #plan = :plan, stripeCustomerId = :cid, stripeSubscriptionId = :sid, billingStatus = :active',
            ExpressionAttributeNames: { '#plan': 'plan' },
            ExpressionAttributeValues: {
              ':plan': plan,
              ':cid': customerId,
              ':sid': subscriptionId,
              ':active': 'active'
            }
          }));
        }

        console.log(`✅ Subscription activated for ${email}: ${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status; // active, past_due, canceled, etc.

        console.log(`🔄 Subscription updated for ${customerId}: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        console.log(`❌ Subscription cancelled for ${customerId}`);
        
        // TODO: Downgrade bots to free tier or pause them
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        console.log(`💰 Invoice paid: $${invoice.amount_paid / 100} for ${invoice.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log(`⚠️ Payment failed for ${invoice.customer}`);
        
        // TODO: Send alert to admin, notify customer
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    // Always return 200 to acknowledge receipt
    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};
