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

const { QueryCommand, ScanCommand, UpdateCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}));
    let event;

    if (stripeKey && webhookSecret) {
      // Production: verify webhook signature
      const stripe = require('stripe')(stripeKey);
      const sig = req.headers['stripe-signature'];
      
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } else {
      // Dev mode: accept raw event
      event = Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString('utf8') || '{}')
        : (req.body || {});
    }

    if (!event || !event.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (event.id) {
      const alreadyProcessed = await wasEventProcessed(event.id);
      if (alreadyProcessed) {
        return res.json({ received: true, duplicate: true });
      }
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
        const users = await db.send(new QueryCommand({
          TableName: TABLES.TENANTS,
          IndexName: 'email-index',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: { ':email': email }
        }));

        for (const user of (users.Items || [])) {
          await db.send(new UpdateCommand({
            TableName: TABLES.TENANTS,
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
        const subscriptionId = subscription.id;

        await updateTenantsByCustomerId(customerId, {
          stripeSubscriptionId: subscriptionId,
          billingStatus: status,
          updatedAt: new Date().toISOString(),
        });

        console.log(`🔄 Subscription updated for ${customerId}: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const subscriptionId = subscription.id;

        console.log(`❌ Subscription cancelled for ${customerId}`);

        await updateTenantsByCustomerId(customerId, {
          stripeSubscriptionId: subscriptionId,
          billingStatus: 'canceled',
          updatedAt: new Date().toISOString(),
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        console.log(`💰 Invoice paid: $${invoice.amount_paid / 100} for ${invoice.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        console.log(`⚠️ Payment failed for ${customerId}`);

        await updateTenantsByCustomerId(customerId, {
          billingStatus: 'past_due',
          updatedAt: new Date().toISOString(),
        });
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    if (event.id) {
      await markEventProcessed(event.id, event.type);
    }

    // Always return 200 to acknowledge receipt
    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

async function wasEventProcessed(eventId) {
  try {
    const existing = await db.send(new GetCommand({
      TableName: TABLES.STRIPE_EVENTS,
      Key: { eventId }
    }));
    return !!existing.Item;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      return false;
    }
    throw err;
  }
}

async function markEventProcessed(eventId, eventType) {
  try {
    await db.send(new PutCommand({
      TableName: TABLES.STRIPE_EVENTS,
      Item: {
        eventId,
        eventType,
        processedAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(eventId)',
    }));
  } catch (err) {
    // Table may not be provisioned in local dev; do not fail webhook handling.
    if (err.name === 'ResourceNotFoundException' || err.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw err;
  }
}

async function updateTenantsByCustomerId(customerId, fields) {
  if (!customerId) return;
  const result = await db.send(new ScanCommand({
    TableName: TABLES.TENANTS,
    FilterExpression: 'stripeCustomerId = :cid',
    ExpressionAttributeValues: { ':cid': customerId },
  }));

  const items = result.Items || [];
  for (const item of items) {
    const updates = [];
    const values = {};
    const names = {};

    if (fields.stripeSubscriptionId !== undefined) {
      updates.push('stripeSubscriptionId = :sid');
      values[':sid'] = fields.stripeSubscriptionId;
    }
    if (fields.billingStatus !== undefined) {
      updates.push('billingStatus = :status');
      values[':status'] = fields.billingStatus;
    }
    if (fields.updatedAt !== undefined) {
      updates.push('#updatedAt = :updatedAt');
      names['#updatedAt'] = 'updatedAt';
      values[':updatedAt'] = fields.updatedAt;
    }
    if (!updates.length) continue;

    await db.send(new UpdateCommand({
      TableName: TABLES.TENANTS,
      Key: { tenantId: item.tenantId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
    }));
  }
}
