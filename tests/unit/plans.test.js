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

  test('no free plan exists (card required)', () => {
    expect(plans.free).toBeUndefined();
  });

  test('starter plan is cheapest at $29', () => {
    expect(plans.starter.price).toBe(29);
  });

  test('VALID_PLANS contains all plan keys', () => {
    expect(VALID_PLANS.has('starter')).toBe(true);
    expect(VALID_PLANS.has('pro')).toBe(true);
    expect(VALID_PLANS.has('business')).toBe(true);
    expect(VALID_PLANS.has('enterprise')).toBe(true);
    expect(VALID_PLANS.has('free')).toBe(false);
  });

  test('PLAN_PRICING derived correctly', () => {
    expect(PLAN_PRICING.starter.price).toBe(29);
    expect(PLAN_PRICING.starter.maxBots).toBe(1);
    expect(PLAN_PRICING.pro.price).toBe(99);
    expect(PLAN_PRICING.pro.maxBots).toBe(2);
  });

  test('enterprise plan has null price (custom)', () => {
    expect(plans.enterprise.price).toBeNull();
    expect(plans.enterprise.custom).toBe(true);
  });

  test('all plans have overage rates', () => {
    for (const [key, plan] of Object.entries(plans)) {
      if (!plan.custom) {
        expect(plan.overageRate).toBeGreaterThan(0);
      }
    }
  });

  test('all plans have model access list', () => {
    for (const [key, plan] of Object.entries(plans)) {
      expect(Array.isArray(plan.models)).toBe(true);
      expect(plan.models.length).toBeGreaterThan(0);
    }
  });
});
