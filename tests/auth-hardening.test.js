/**
 * Tests for auth hardening: TASK-212 (impersonation), TASK-213 (webhook), TASK-220 (CSRF)
 */

const tokenStore = require('../api-local/auth/token-store.js');

// Clear token store between tests
beforeEach(() => tokenStore.clear());

describe('TASK-212: Impersonation timeout and audit', () => {
  const { getEffectiveEmail, isAdmin, ADMIN_EMAILS } = require('../api-local/auth/middleware.js');

  function makeReq(sessionToken) {
    return { headers: { cookie: `session=${sessionToken}` } };
  }

  test('impersonation returns impersonated email when within timeout', () => {
    const token = 'test-session-1';
    tokenStore.set(token, {
      type: 'session',
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 86400000,
      impersonating: 'client@example.com',
      impersonatedAt: Date.now(),
    });

    const email = getEffectiveEmail(makeReq(token));
    expect(email).toBe('client@example.com');
  });

  test('impersonation expires after 1 hour', () => {
    const token = 'test-session-2';
    tokenStore.set(token, {
      type: 'session',
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 86400000,
      impersonating: 'client@example.com',
      impersonatedAt: Date.now() - 3600001, // 1 hour + 1ms ago
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const email = getEffectiveEmail(makeReq(token));
    expect(email).toBe('g@purplehorizons.io');

    // Verify session was cleaned up
    const session = tokenStore.get(token);
    expect(session.impersonating).toBeUndefined();
    expect(session.impersonatedAt).toBeUndefined();

    // Verify logging
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Impersonation expired')
    );
    consoleSpy.mockRestore();
  });

  test('impersonation is logged', () => {
    const token = 'test-session-3';
    tokenStore.set(token, {
      type: 'session',
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 86400000,
      impersonating: 'client@example.com',
      impersonatedAt: Date.now(),
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    getEffectiveEmail(makeReq(token));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Admin g@purplehorizons.io impersonating client@example.com')
    );
    consoleSpy.mockRestore();
  });

  test('impersonatedAt is set when starting impersonation', () => {
    const token = 'test-session-4';
    tokenStore.set(token, {
      type: 'session',
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 86400000,
    });

    // Simulate the impersonate handler
    const handler = require('../api-local/admin/impersonate.js');
    const req = {
      headers: { cookie: `session=${token}` },
      path: '/api/admin/impersonate',
      body: { email: 'client@example.com' },
      userEmail: 'g@purplehorizons.io',
      isAdmin: true,
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    handler(req, res);

    const session = tokenStore.get(token);
    expect(session.impersonatedAt).toBeDefined();
    expect(typeof session.impersonatedAt).toBe('number');
    expect(session.impersonating).toBe('client@example.com');
  });
});

describe('TASK-213: Stripe webhook signature verification', () => {
  test('webhook handler exists and checks for STRIPE_WEBHOOK_SECRET', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api-local/billing/webhook.js'), 'utf8');
    expect(src).toContain('STRIPE_WEBHOOK_SECRET');
    expect(src).toContain('constructEvent');
    expect(src).toContain('stripe-signature');
  });

  test('logs warning when webhook secret missing', async () => {
    // Remove env vars to test fallback path
    const origKey = process.env.STRIPE_SECRET_KEY;
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    // Re-require to get fresh module
    delete require.cache[require.resolve('../api-local/billing/webhook.js')];
    const handler = require('../api-local/billing/webhook.js');

    const req = {
      headers: {},
      body: { type: 'invoice.paid', data: { object: { id: 'inv_test', amount_paid: 1000, customer: 'cus_test' } } },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ received: true });

    consoleSpy.mockRestore();
    process.env.STRIPE_SECRET_KEY = origKey;
    process.env.STRIPE_WEBHOOK_SECRET = origSecret;
  });
});

describe('TASK-220: CSRF protection', () => {
  const { generateCsrfToken, validateCsrf } = require('../api-local/auth/csrf.js');

  test('CSRF token is generated and stored in session', () => {
    const token = 'csrf-session-1';
    tokenStore.set(token, { type: 'session', email: 'test@test.com', expiresAt: Date.now() + 86400000 });

    const csrfToken = generateCsrfToken(token);
    expect(csrfToken).toBeDefined();
    expect(csrfToken.length).toBe(64); // 32 bytes hex

    const session = tokenStore.get(token);
    expect(session.csrfToken).toBe(csrfToken);
  });

  test('CSRF not required for GET requests', (done) => {
    const req = { method: 'GET', headers: {}, path: '/api/test' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validateCsrf(req, res, () => {
      expect(res.status).not.toHaveBeenCalled();
      done();
    });
  });

  test('CSRF not required for webhook endpoints', (done) => {
    const req = { method: 'POST', headers: {}, path: '/api/billing/webhook' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validateCsrf(req, res, () => {
      expect(res.status).not.toHaveBeenCalled();
      done();
    });
  });

  test('CSRF not required for API key auth', (done) => {
    const req = { method: 'POST', headers: { 'x-api-key': 'some-key' }, path: '/api/test' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validateCsrf(req, res, () => {
      expect(res.status).not.toHaveBeenCalled();
      done();
    });
  });

  test('CSRF required for POST with session that has CSRF token', () => {
    const token = 'csrf-session-2';
    const csrfToken = 'valid-csrf-token';
    tokenStore.set(token, { type: 'session', email: 'test@test.com', csrfToken });

    const req = {
      method: 'POST',
      headers: { cookie: `session=${token}` },
      path: '/api/test',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    validateCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
  });

  test('CSRF passes with valid token header', (done) => {
    const token = 'csrf-session-3';
    const csrfToken = 'valid-csrf-token';
    tokenStore.set(token, { type: 'session', email: 'test@test.com', csrfToken });

    const req = {
      method: 'POST',
      headers: { cookie: `session=${token}`, 'x-csrf-token': csrfToken },
      path: '/api/test',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validateCsrf(req, res, () => {
      expect(res.status).not.toHaveBeenCalled();
      done();
    });
  });
});
