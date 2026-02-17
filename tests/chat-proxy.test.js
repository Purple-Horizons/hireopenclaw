/**
 * Chat Proxy Unit Tests (TASK-302)
 * 
 * These tests ensure the chat proxy module works correctly and
 * prevent accidental deletion from going unnoticed.
 */

// ─── Mocks ───

jest.mock('../api-local/auth/token-store.js', () => ({
  get: jest.fn(),
}));

jest.mock('../api-local/util/dynamodb.js', () => ({
  client: { send: jest.fn() },
  TABLES: { tenants: 'clawops-tenants' },
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  GetItemCommand: jest.fn((params) => params),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: jest.fn((item) => item._unmarshalled || item),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const tokenStore = require('../api-local/auth/token-store.js');
const { client: dynamodb } = require('../api-local/util/dynamodb.js');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { handleSend, handleHistory, handleClear } = require('../api-local/chat/proxy.js');

// ─── Helpers ───

function mockReq({ cookies = '', params = {}, body = {}, query = {}, headers = {} } = {}) {
  return {
    headers: { cookie: cookies, ...headers },
    params,
    body,
    query,
    on: jest.fn(),
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
  return res;
}

function setupValidSession(email = 'user@test.com') {
  tokenStore.get.mockResolvedValue({
    type: 'session',
    email,
    expiresAt: Date.now() + 3600000,
  });
}

function setupBot(overrides = {}) {
  const bot = {
    _unmarshalled: {
      tenantId: 'bot-123',
      email: 'user@test.com',
      status: 'active',
      endpoint: 'https://bot.example.com',
      gatewayToken: 'gw-token-abc',
      ...overrides,
    },
  };
  dynamodb.send.mockResolvedValue({ Item: bot });
  unmarshall.mockReturnValue(bot._unmarshalled);
  return bot._unmarshalled;
}

// ─── Tests ───

beforeEach(() => {
  jest.clearAllMocks();
});

// ── validateSession (tested indirectly via handlers) ──

describe('validateSession (via handlers)', () => {
  test('valid token → authenticates (returns email)', async () => {
    setupValidSession('alice@example.com');
    setupBot({ email: 'alice@example.com' });

    const req = mockReq({
      cookies: 'session=valid-token',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    
    // Use handleHistory as a lightweight probe
    await handleHistory(req, res);
    expect(tokenStore.get).toHaveBeenCalledWith('valid-token');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('expired token → 401', async () => {
    tokenStore.get.mockResolvedValue({
      type: 'session',
      email: 'user@test.com',
      expiresAt: Date.now() - 1000, // expired
    });

    const req = mockReq({
      cookies: 'session=expired-token',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    await handleHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('missing token → 401', async () => {
    const req = mockReq({ params: { botId: 'bot-123' } });
    const res = mockRes();
    await handleHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── getBotForUser (tested indirectly) ──

describe('getBotForUser (via handlers)', () => {
  test('bot exists and owned → returns bot (handler succeeds)', async () => {
    setupValidSession('owner@test.com');
    setupBot({ email: 'owner@test.com' });

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    await handleHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('bot exists but different owner → 403', async () => {
    setupValidSession('other@test.com');
    setupBot({ email: 'real-owner@test.com' });

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    await handleHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── handleSend ──

describe('handleSend', () => {
  test('valid session + owned bot → 200 (non-streaming)', async () => {
    setupValidSession();
    setupBot();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello back!' } }],
        usage: { total_tokens: 10 },
      }),
    });

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
      body: { message: 'Hello' },
      query: {},
    });
    const res = mockRes();
    await handleSend(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, content: 'Hello back!' })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://bot.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('no session cookie → 401', async () => {
    tokenStore.get.mockResolvedValue(null);

    const req = mockReq({
      params: { botId: 'bot-123' },
      body: { message: 'Hello' },
    });
    const res = mockRes();
    await handleSend(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('bot not owned by user → 403', async () => {
    setupValidSession('intruder@test.com');
    setupBot({ email: 'owner@test.com' });

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
      body: { message: 'Hello' },
    });
    const res = mockRes();
    await handleSend(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('bot not found in DB → 403 (not found treated as access denied)', async () => {
    setupValidSession();
    dynamodb.send.mockResolvedValue({ Item: null });

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'nonexistent' },
      body: { message: 'Hello' },
    });
    const res = mockRes();
    await handleSend(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── handleHistory ──

describe('handleHistory', () => {
  test('returns conversation from in-memory store', async () => {
    setupValidSession();
    const bot = setupBot();

    // First send a message to populate history
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Reply' } }],
        usage: {},
      }),
    });

    const sendReq = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
      body: { message: 'Hi' },
    });
    await handleSend(sendReq, mockRes());

    // Now fetch history
    setupValidSession();
    setupBot();
    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    await handleHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.ok).toBe(true);
    expect(jsonCall.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Hi' }),
        expect.objectContaining({ role: 'assistant', content: 'Reply' }),
      ])
    );
  });

  test('no session → 401', async () => {
    tokenStore.get.mockResolvedValue(null);
    const req = mockReq({ params: { botId: 'bot-123' } });
    const res = mockRes();
    await handleHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── handleClear ──

describe('handleClear', () => {
  test('clears conversation, returns success', async () => {
    setupValidSession();
    setupBot();

    const req = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
    });
    const res = mockRes();
    await handleClear(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });

    // Verify history is empty after clear
    setupValidSession();
    setupBot();
    const histReq = mockReq({
      cookies: 'session=tok',
      params: { botId: 'bot-123' },
    });
    const histRes = mockRes();
    await handleHistory(histReq, histRes);
    expect(histRes.json.mock.calls[0][0].messages).toEqual([]);
  });

  test('no session → 401', async () => {
    tokenStore.get.mockResolvedValue(null);
    const req = mockReq({ params: { botId: 'bot-123' } });
    const res = mockRes();
    await handleClear(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
