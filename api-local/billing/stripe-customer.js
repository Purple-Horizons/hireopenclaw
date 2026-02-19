const { getTeamByOwner } = require('../auth/team-plan.js');
const { updateTeamBillingByEmail } = require('./team-billing.js');

async function getOrCreateStripeCustomerId(stripe, email) {
  if (!stripe || !email) return null;

  const team = await getTeamByOwner(email);
  if (team?.stripeCustomerId) {
    return team.stripeCustomerId;
  }

  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing?.data?.length) {
    const customerId = existing.data[0].id;
    await updateTeamBillingByEmail(email, { stripeCustomerId: customerId });
    return customerId;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { source: 'hireopenclaw' },
  });
  await updateTeamBillingByEmail(email, { stripeCustomerId: customer.id });
  return customer.id;
}

module.exports = {
  getOrCreateStripeCustomerId,
};
