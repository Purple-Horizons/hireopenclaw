const { plans, VALID_PLANS, PLAN_PRICING, PLAN_BOT_LIMITS } = require('../../api-local/data/plans');

describe('plans data', () => {
  test('all plans have required fields', () => {
    for (const [key, plan] of Object.entries(plans)) {
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('price');
      expect(plan).toHaveProperty('employees');
      expect(plan).toHaveProperty('interactions');
      expect(typeof plan.name).toBe('string');
    }
  });

  test('price is number or null', () => {
    for (const [key, plan] of Object.entries(plans)) {
      expect(plan.price === null || typeof plan.price === 'number').toBe(true);
    }
  });

  test('free plan has price 0', () => {
    expect(plans.free.price).toBe(0);
  });

  test('VALID_PLANS contains all plan keys', () => {
    expect(VALID_PLANS.has('free')).toBe(true);
    expect(VALID_PLANS.has('starter')).toBe(true);
    expect(VALID_PLANS.has('pro')).toBe(true);
    expect(VALID_PLANS.has('business')).toBe(true);
    expect(VALID_PLANS.has('enterprise')).toBe(true);
  });

  test('PLAN_PRICING derived correctly', () => {
    expect(PLAN_PRICING.free.price).toBe(0);
    expect(PLAN_PRICING.free.maxBots).toBe(1);
  });

  test('enterprise plan has null price (custom)', () => {
    expect(plans.enterprise.price).toBeNull();
    expect(plans.enterprise.custom).toBe(true);
  });
});
