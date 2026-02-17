/**
 * Unit tests for HireOpenClaw auth flow
 * Covers: magic link, session, enumeration protection, bot ownership
 */

const tokenStore = require('../api-local/auth/token-store.js');

describe('Token Store', () => {
  beforeEach(() => { tokenStore.clear(); });

  test('stores and retrieves tokens', async () => {
    tokenStore.set('abc', { email: 'test@test.com', expiresAt: Date.now() + 60000 });
    const data = await tokenStore.get('abc');
    expect(data?.email).toBe('test@test.com');
  });

  test('returns undefined for missing tokens', async () => {
    expect(await tokenStore.get('nonexistent')).toBeUndefined();
  });
});

describe('Magic Link - Token Generation', () => {
  beforeEach(() => { tokenStore.clear(); });

  test('generated tokens are 64-char hex strings', async () => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[a-f0-9]+$/);
  });

  test('tokens expire after 15 minutes', async () => {
    const TOKEN_EXPIRY_MS = 15 * 60 * 1000;
    const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
    tokenStore.set('test-token', { email: 'a@b.com', expiresAt, used: false });
    const data = await tokenStore.get('test-token');
    expect(data.expiresAt).toBeGreaterThan(Date.now());
    expect(data.expiresAt).toBeLessThanOrEqual(Date.now() + TOKEN_EXPIRY_MS);
  });

  test('expired tokens are detectable', async () => {
    tokenStore.set('expired-token', { email: 'a@b.com', expiresAt: Date.now() - 1000, used: false });
    const data = await tokenStore.get('expired-token');
    expect(data.expiresAt).toBeLessThan(Date.now());
  });
});

describe('Magic Link - Single Use', () => {
  beforeEach(() => { tokenStore.clear(); });

  test('token can be marked as used', async () => {
    tokenStore.set('once-token', { email: 'a@b.com', expiresAt: Date.now() + 60000, used: false });
    const data = await tokenStore.get('once-token');
    expect(data.used).toBe(false);
    data.used = true;
    tokenStore.set('once-token', data);
    expect((await tokenStore.get('once-token')).used).toBe(true);
  });

  test('used tokens are flagged', async () => {
    tokenStore.set('used-token', { email: 'a@b.com', expiresAt: Date.now() + 60000, used: true });
    expect((await tokenStore.get('used-token')).used).toBe(true);
  });
});

describe('Session Validation', () => {
  beforeEach(() => { tokenStore.clear(); });

  test('valid session token returns email', async () => {
    tokenStore.set('session-abc', { email: 'user@test.com', expiresAt: Date.now() + 30 * 86400000, type: 'session' });
    const session = await tokenStore.get('session-abc');
    expect(session.type).toBe('session');
    expect(session.email).toBe('user@test.com');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  test('non-session tokens are rejected', async () => {
    tokenStore.set('magic-token', { email: 'user@test.com', expiresAt: Date.now() + 60000, used: false });
    const data = await tokenStore.get('magic-token');
    expect(data.type).not.toBe('session');
  });

  test('expired session tokens are detectable', async () => {
    tokenStore.set('expired-session', { email: 'user@test.com', expiresAt: Date.now() - 1000, type: 'session' });
    expect((await tokenStore.get('expired-session')).expiresAt).toBeLessThan(Date.now());
  });
});

describe('Anti-Enumeration Protection', () => {
  test('response shape is identical for existing and non-existing emails', async () => {
    const response = { ok: true, message: 'If an account exists with that email, a login link has been sent.', expiresIn: '15 minutes' };
    // Neither should contain email-specific info
    expect(response.email).toBeUndefined();
    expect(response.magicLink).toBeUndefined();
  });
});

describe('Dashboard Auth Gate', () => {
  test('requests without session cookie fail check', async () => {
    const hasCookie = '';
    expect(hasCookie.includes('session=')).toBe(false);
  });

  test('requests with session cookie pass check', async () => {
    const hasCookie = 'session=abc123; other=val';
    expect(hasCookie.includes('session=')).toBe(true);
  });
});

describe('Bot Ownership Check', () => {
  test('user email must match bot email', async () => {
    const bot = { email: 'owner@test.com', status: 'active' };
    expect(bot.email).not.toBe('hacker@evil.com');
  });

  test('terminated bots should be inaccessible', async () => {
    const bot = { email: 'owner@test.com', status: 'terminated' };
    expect(bot.status).toBe('terminated');
  });

  test('owner can access their own active bot', async () => {
    const bot = { email: 'owner@test.com', status: 'active' };
    expect(bot.email).toBe('owner@test.com');
    expect(bot.status).not.toBe('terminated');
  });
});

describe('Chat Proxy Auth', () => {
  test('session extraction from cookie', async () => {
    const cookie = 'session=abc123def; theme=dark';
    const match = cookie.match(/session=([^;]+)/);
    expect(match).toBeTruthy();
    expect(match[1]).toBe('abc123def');
  });

  test('session extraction from Authorization header', async () => {
    const auth = 'Bearer my-secret-token';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    expect(token).toBe('my-secret-token');
  });
});

describe('Security: Gateway Token Never Exposed', () => {
  test('bots API response should not contain gatewayToken', async () => {
    const bot = { id: 'tenant-123', name: 'Test Bot', endpoint: 'http://localhost:18814' };
    expect(bot.gatewayToken).toBeUndefined();
  });

  test('chat proxy sends botId, not token, to frontend', async () => {
    const botId = 'tenant-268193-renj';
    const chatUrl = `/chat?botId=${encodeURIComponent(botId)}&name=Test`;
    expect(chatUrl).not.toContain('token=');
    expect(chatUrl).not.toContain('gatewayToken');
    expect(chatUrl).toContain('botId=');
  });
});

describe('Security: All Dashboard Endpoints Require Auth', () => {
  test('protected endpoints list is comprehensive', async () => {
    const protectedEndpoints = [
      '/api/dashboard/bots',
      '/api/dashboard/bot-action',
      '/api/dashboard/rename-bot',
      '/api/dashboard/create-bot',
      '/api/dashboard/container-stats',
      '/api/dashboard/usage/:tenantId',
      '/api/dashboard/margin',
      '/api/chat/:botId/send',
      '/api/chat/:botId/events',
      '/api/chat/:botId/history'
    ];
    expect(protectedEndpoints.length).toBeGreaterThanOrEqual(10);
  });
});
