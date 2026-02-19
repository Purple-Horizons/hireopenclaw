process.env.NODE_ENV = 'test';

const mockRequireAuth = jest.fn();
const mockGetTeamByOwner = jest.fn();
const mockUpdateTeamBillingByEmail = jest.fn();
const mockGetOrCreateStripeCustomerId = jest.fn();
const mockPortalCreate = jest.fn();

jest.mock('../api-local/auth/middleware.js', () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
}));

jest.mock('../api-local/auth/team-plan.js', () => ({
  getTeamByOwner: (...args) => mockGetTeamByOwner(...args),
}));

jest.mock('../api-local/billing/team-billing.js', () => ({
  updateTeamBillingByEmail: (...args) => mockUpdateTeamBillingByEmail(...args),
  normalizeUsagePolicy: jest.fn((policy) => ({
    mode: policy?.mode || 'notify_only',
    updatedAt: policy?.updatedAt || null,
  })),
}));

jest.mock('../api-local/billing/stripe-customer.js', () => ({
  getOrCreateStripeCustomerId: (...args) => mockGetOrCreateStripeCustomerId(...args),
}));

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  billingPortal: {
    sessions: {
      create: (...args) => mockPortalCreate(...args),
    },
  },
  subscriptions: {
    list: jest.fn(),
    update: jest.fn(),
  },
})));

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('Billing plan change handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';
    mockRequireAuth.mockResolvedValue('owner@example.com');
    mockGetTeamByOwner.mockResolvedValue({ teamId: 'team-1', plan: 'starter' });
    mockUpdateTeamBillingByEmail.mockResolvedValue({ usagePolicy: { mode: 'hard_cap' } });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.test/session_123' });
  });

  test('change-plan simulates update in dev mode without Stripe key', async () => {
    const handler = require('../api-local/billing/change-plan.js');
    const req = { method: 'POST', body: { plan: 'pro' }, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('development');
    expect(mockUpdateTeamBillingByEmail).toHaveBeenCalledWith(
      'owner@example.com',
      expect.objectContaining({ plan: 'pro' })
    );
  });

  test('change-plan routes downgrade to portal when Stripe is configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    mockGetTeamByOwner.mockResolvedValue({ teamId: 'team-1', plan: 'business' });
    mockGetOrCreateStripeCustomerId.mockResolvedValue('cus_123');

    const handler = require('../api-local/billing/change-plan.js');
    const req = { method: 'POST', body: { plan: 'starter', applyAt: 'next_cycle' }, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.requiresPortal).toBe(true);
    expect(res.body.url).toContain('billing.stripe.test');
    expect(mockPortalCreate).toHaveBeenCalled();
  });

  test('usage-policy updates team policy mode', async () => {
    const handler = require('../api-local/billing/usage-policy.js');
    const req = { method: 'POST', body: { mode: 'hard_cap' }, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpdateTeamBillingByEmail).toHaveBeenCalledWith(
      'owner@example.com',
      expect.objectContaining({
        usagePolicy: expect.objectContaining({ mode: 'hard_cap' }),
      })
    );
  });
});
