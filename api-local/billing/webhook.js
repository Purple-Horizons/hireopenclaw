/**
 * POST /api/billing/webhook
 * Stripe webhook handler
 *
 * Events handled:
 * - checkout.session.completed -> Activate subscription + assign plan
 * - customer.subscription.updated -> Plan/status changes
 * - customer.subscription.deleted -> Cancellation
 * - invoice.paid -> Mark active
 * - invoice.payment_failed -> Mark past_due
 */

const { QueryCommand, ScanCommand, UpdateCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient: db, TABLES } = require('../util/dynamodb.js');
const { updateTeamBillingByEmail } = require('./team-billing.js');
const { normalizePlan, getPlanByStripePriceId } = require('./stripe-plans.js');

module.exports = async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}));
    let event;
    let stripe = null;

    if (stripeKey && webhookSecret) {
      stripe = require('stripe')(stripeKey);
      const sig = req.headers['stripe-signature'];

      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } else {
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
        const email = String(
          session.metadata?.email
          || session.customer_details?.email
          || session.customer_email
          || ''
        ).trim().toLowerCase();
        const customerId = session.customer || null;
        const subscriptionId = session.subscription || null;
        const plan = normalizePlan(session.metadata?.plan) || 'starter';

        if (!email) {
          console.warn('[Stripe Webhook] checkout.session.completed missing email');
          break;
        }

        await updateRecordsByEmail(email, {
          plan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          billingStatus: 'active',
        });

        console.log(`✅ Subscription activated for ${email}: ${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status;
        const subscriptionId = subscription.id;
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;
        const priceId = subscription.items?.data?.[0]?.price?.id || null;
        const plan = normalizePlan(subscription.metadata?.plan) || getPlanByStripePriceId(priceId);

        const updated = await updateRecordsByCustomerId(customerId, {
          plan,
          stripeSubscriptionId: subscriptionId,
          billingStatus: status,
          currentPeriodEnd,
        });

        if (!updated && stripeKey && stripe && customerId) {
          const customer = await stripe.customers.retrieve(customerId);
          const email = String(customer?.email || '').trim().toLowerCase();
          if (email) {
            await updateRecordsByEmail(email, {
              plan,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              billingStatus: status,
              currentPeriodEnd,
            });
          }
        }

        console.log(`🔄 Subscription updated for ${customerId}: ${status}${plan ? ` (${plan})` : ''}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const subscriptionId = subscription.id;

        await updateRecordsByCustomerId(customerId, {
          stripeSubscriptionId: subscriptionId,
          billingStatus: 'canceled',
        });

        console.log(`❌ Subscription cancelled for ${customerId}`);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        await updateRecordsByCustomerId(invoice.customer, { billingStatus: 'active' });
        console.log(`💰 Invoice paid: $${invoice.amount_paid / 100} for ${invoice.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await updateRecordsByCustomerId(invoice.customer, { billingStatus: 'past_due' });
        console.log(`⚠️ Payment failed for ${invoice.customer}`);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    if (event.id) {
      await markEventProcessed(event.id, event.type);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

async function wasEventProcessed(eventId) {
  try {
    const existing = await db.send(new GetCommand({
      TableName: TABLES.STRIPE_EVENTS,
      Key: { eventId },
    }));
    return !!existing.Item;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
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
    if (err.name === 'ResourceNotFoundException' || err.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw err;
  }
}

async function updateRecordsByEmail(email, fields) {
  if (!email) return false;
  await updateTeamBillingByEmail(email, fields);
  await updateTenantsByEmail(email, fields);
  return true;
}

async function updateRecordsByCustomerId(customerId, fields) {
  if (!customerId) return false;
  const [tenantCount, teamCount] = await Promise.all([
    updateTenantsByCustomerId(customerId, fields),
    updateTeamsByCustomerId(customerId, fields),
  ]);
  return (tenantCount + teamCount) > 0;
}

async function updateTenantsByEmail(email, fields) {
  const result = await db.send(new QueryCommand({
    TableName: TABLES.TENANTS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
  }));
  const items = result.Items || [];
  for (const item of items) {
    await updateTenant(item.tenantId, fields);
  }
  return items.length;
}

async function updateTenantsByCustomerId(customerId, fields) {
  const result = await db.send(new ScanCommand({
    TableName: TABLES.TENANTS,
    FilterExpression: 'stripeCustomerId = :cid',
    ExpressionAttributeValues: { ':cid': customerId },
  }));
  const items = result.Items || [];
  for (const item of items) {
    await updateTenant(item.tenantId, fields);
  }
  return items.length;
}

async function updateTeamsByCustomerId(customerId, fields) {
  const result = await db.send(new ScanCommand({
    TableName: TABLES.TEAMS,
    FilterExpression: 'stripeCustomerId = :cid',
    ExpressionAttributeValues: { ':cid': customerId },
  }));
  const items = result.Items || [];
  for (const team of items) {
    const ownerEmail = team.ownerId || team.email;
    if (!ownerEmail) continue;
    await updateTeamBillingByEmail(ownerEmail, fields);
  }
  return items.length;
}

async function updateTenant(tenantId, fields) {
  const updates = [];
  const values = {};
  const names = {};

  if (fields.plan) {
    updates.push('#plan = :plan');
    names['#plan'] = 'plan';
    values[':plan'] = fields.plan;
  }
  if (fields.stripeCustomerId !== undefined) {
    updates.push('stripeCustomerId = :stripeCustomerId');
    values[':stripeCustomerId'] = fields.stripeCustomerId;
  }
  if (fields.stripeSubscriptionId !== undefined) {
    updates.push('stripeSubscriptionId = :stripeSubscriptionId');
    values[':stripeSubscriptionId'] = fields.stripeSubscriptionId;
  }
  if (fields.billingStatus !== undefined) {
    updates.push('billingStatus = :billingStatus');
    values[':billingStatus'] = fields.billingStatus;
  }
  if (fields.currentPeriodEnd !== undefined) {
    updates.push('currentPeriodEnd = :currentPeriodEnd');
    values[':currentPeriodEnd'] = fields.currentPeriodEnd;
  }
  if (!updates.length) return;

  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = new Date().toISOString();

  await db.send(new UpdateCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    ExpressionAttributeValues: values,
  }));
}
