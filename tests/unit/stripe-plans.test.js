const {
  normalizePlan,
  getStripePriceIdForPlan,
  getPlanByStripePriceId,
  getCheckoutEligiblePlans,
} = require('../../api-local/billing/stripe-plans.js');

describe('stripe plan mapping helpers', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';
  });

  test('normalizes legacy aliases to canonical plan names', () => {
    expect(normalizePlan('professional')).toBe('pro');
    expect(normalizePlan('team')).toBe('business');
    expect(normalizePlan('starter')).toBe('starter');
  });

  test('maps canonical plans to Stripe price ids and back', () => {
    expect(getStripePriceIdForPlan('pro')).toBe('price_pro');
    expect(getPlanByStripePriceId('price_business')).toBe('business');
  });

  test('returns only paid, checkout-eligible plans', () => {
    const plans = getCheckoutEligiblePlans();
    expect(plans).toContain('starter');
    expect(plans).toContain('pro');
    expect(plans).toContain('business');
    expect(plans).not.toContain('free');
    expect(plans).not.toContain('enterprise');
  });
});
