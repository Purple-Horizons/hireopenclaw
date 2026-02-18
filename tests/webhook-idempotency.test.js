const mockSend = jest.fn();

jest.mock('../api-local/util/dynamodb.js', () => ({
  docClient: { send: (...args) => mockSend(...args) },
  TABLES: {
    TENANTS: 'clawops-tenants',
    STRIPE_EVENTS: 'clawops-stripe-events',
  },
}));

const handler = require('../api-local/billing/webhook.js');

function mockReq(body) {
  return {
    method: 'POST',
    body,
    headers: {},
  };
}

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

describe('Stripe webhook idempotency', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  test('returns duplicate=true when event was already processed', async () => {
    mockSend.mockResolvedValueOnce({ Item: { eventId: 'evt_123' } });
    const req = mockReq({ id: 'evt_123', type: 'test.event', data: { object: { id: 'obj_1' } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ received: true, duplicate: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('marks new event as processed after handling', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined }) // wasEventProcessed
      .mockResolvedValueOnce({}); // markEventProcessed

    const req = mockReq({ id: 'evt_456', type: 'test.event', data: { object: { id: 'obj_2' } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ received: true });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
