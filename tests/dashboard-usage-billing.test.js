process.env.NODE_ENV = 'test';

const mockSend = jest.fn();
const mockRequireAuth = jest.fn();
const mockRequireBotOwnership = jest.fn();
const mockGetUserPlan = jest.fn();

jest.mock('../api-local/auth/middleware.js', () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
  requireBotOwnership: (...args) => mockRequireBotOwnership(...args),
}));

jest.mock('../api-local/auth/team-plan.js', () => ({
  getUserPlan: (...args) => mockGetUserPlan(...args),
}));

jest.mock('../api-local/util/dynamodb.js', () => ({
  client: { send: (...args) => mockSend(...args) },
  TABLES: {
    TENANTS: 'clawops-tenants',
    USAGE: 'clawops-usage',
    TEAMS: 'clawops-teams',
  },
}));

const { marshall } = require('@aws-sdk/util-dynamodb');

function ddbItem(obj) {
  return marshall(obj, { removeUndefinedValues: true });
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
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

describe('Dashboard usage + billing aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue('owner@example.com');
    mockRequireBotOwnership.mockResolvedValue({ tenantId: 'tenant-1', email: 'owner@example.com' });
    mockGetUserPlan.mockResolvedValue('enterprise');
  });

  test('billing endpoint returns custom plan semantics and aggregates monthly tokens', async () => {
    const billingHandler = require('../api-local/dashboard/billing.js');
    const today = new Date().toISOString().slice(0, 10);

    mockSend
      .mockResolvedValueOnce({
        Items: [ddbItem({ tenantId: 'tenant-1', email: 'owner@example.com' })],
      })
      .mockResolvedValueOnce({
        Items: [ddbItem({ tenantId: 'tenant-1', date: today, inputTokenCount: 1200, completion_tokens: 300 })],
      });

    const req = { method: 'GET', query: {}, params: {}, headers: {} };
    const res = mockRes();

    await billingHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.plan).toBe('enterprise');
    expect(res.body.customPlan).toBe(true);
    expect(res.body.planPrice).toBeNull();
    expect(res.body.nextBillingDate).toBeNull();
    expect(res.body.usage.tokensUsed).toBe(1500);
    expect(res.body.usage.tokensLimit).toBeNull();
    expect(res.body.usage.percentUsed).toBeNull();
    expect(res.body.bots.count).toBe(1);
  });

  test('tenant usage endpoint estimates cost when explicit cost is missing', async () => {
    const usageHandler = require('../api-local/dashboard/usage.js');
    const today = new Date().toISOString().slice(0, 10);

    mockSend.mockResolvedValueOnce({
      Items: [
        ddbItem({ tenantId: 'tenant-1', date: today, tokenIn: 1000, tokenOut: 400 }),
        ddbItem({ tenantId: 'tenant-1', date: today, inputTokens: 500, outputTokens: 500, costUsd: 0.01 }),
      ],
    });

    const req = { method: 'GET', params: { tenantId: 'tenant-1' }, query: {}, headers: {} };
    const res = mockRes();

    await usageHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.plan).toBe('enterprise');
    expect(res.body.usage.tokensIn).toBe(1500);
    expect(res.body.usage.tokensOut).toBe(900);
    expect(res.body.usage.requestCount).toBe(2);
    expect(res.body.usage.totalCost).toBeCloseTo(0.019, 6);
    expect(res.body.usage.todayCost).toBeCloseTo(0.019, 6);
  });

  test('email usage aggregation supports token/message aliases', async () => {
    const usageHandler = require('../api-local/dashboard/usage.js');
    const today = new Date().toISOString().slice(0, 10);

    mockSend
      .mockResolvedValueOnce({
        Items: [ddbItem({ tenantId: 'tenant-1', email: 'owner@example.com' })],
      })
      .mockResolvedValueOnce({
        Items: [ddbItem({ tenantId: 'tenant-1', date: today, tokens_input: 100, tokens_output: 40, requestCount: 7 })],
      });

    const req = { method: 'GET', params: {}, query: { days: '30' }, headers: {} };
    const res = mockRes();

    await usageHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dailyUsage).toHaveLength(1);
    expect(res.body.dailyUsage[0].inputTokens).toBe(100);
    expect(res.body.dailyUsage[0].outputTokens).toBe(40);
    expect(res.body.dailyUsage[0].messageCount).toBe(7);
  });
});
