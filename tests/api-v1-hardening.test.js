process.env.NODE_ENV = 'test';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand { constructor(params) { this.params = params; } }
  class GetCommand { constructor(params) { this.params = params; } }
  class UpdateCommand { constructor(params) { this.params = params; } }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand,
    GetCommand,
    UpdateCommand,
  };
});

const mockExecFileSync = jest.fn();
jest.mock('child_process', () => ({
  execFileSync: (...args) => mockExecFileSync(...args),
}));

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('API v1 hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    mockExecFileSync.mockReset();
  });

  test('create bot rejects invalid name', async () => {
    const handler = require('../api-v1/bots/create.js');
    const req = {
      apiKey: { scopes: ['bots:create'], teamId: null },
      userId: 'owner@example.com',
      body: { name: 'bad;name', template: 'blank', plan: 'starter' },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid bot name/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  test('create bot does not expose gateway token and uses execFileSync args', async () => {
    const handler = require('../api-v1/bots/create.js');
    mockSend.mockResolvedValueOnce({});

    const req = {
      apiKey: { scopes: ['bots:create'], teamId: null },
      userId: 'owner@example.com',
      body: { name: 'Safe Bot', template: 'blank', plan: 'starter' },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.gatewayToken).toBeUndefined();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining([
        expect.stringContaining('provision-local.sh'),
        '--tenant-id',
        expect.stringMatching(/^tenant-/),
        '--name',
        'Safe Bot',
        '--template',
        'blank',
      ]),
      expect.any(Object)
    );
  });

  test('delete bot rejects invalid tenant id format', async () => {
    const handler = require('../api-v1/bots/delete.js');
    const req = {
      apiKey: { scopes: ['bots:delete'] },
      userId: 'owner@example.com',
      params: { id: 'bad/id' },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid bot ID format/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('delete bot allows owner match via email field', async () => {
    const handler = require('../api-v1/bots/delete.js');
    mockSend
      .mockResolvedValueOnce({ Item: { tenantId: 'tenant-123-aaaa', email: 'owner@example.com', name: 'Bot A', status: 'active' } })
      .mockResolvedValueOnce({});

    const req = {
      apiKey: { scopes: ['bots:delete'] },
      userId: 'owner@example.com',
      params: { id: 'tenant-123-aaaa' },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
