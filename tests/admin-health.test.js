process.env.NODE_ENV = 'test';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_DEFAULT_REGION = 'us-east-1';
process.env.ADMIN_EMAILS = 'g@purplehorizons.io';

const request = require('supertest');
const tokenStore = require('../api-local/auth/token-store.js');

// Mock fetch for proxy health check
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ status: 'ok', providers: ['anthropic', 'openai'] }),
  })
);

let app;
beforeAll(() => {
  const http = require('http');
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function () { return this; };
  app = require('../server');
  http.Server.prototype.listen = originalListen;

  // Create admin session token
  tokenStore.set('admin-health-tok', {
    email: 'g@purplehorizons.io',
    type: 'session',
    expiresAt: Date.now() + 86400000,
  });
  // Non-admin token
  tokenStore.set('user-health-tok', {
    email: 'nobody@example.com',
    type: 'session',
    expiresAt: Date.now() + 86400000,
  });
});

function adminHeaders() {
  return { 'x-csrf-token': 'test', Cookie: 'session=admin-health-tok' };
}
function userHeaders() {
  return { 'x-csrf-token': 'test', Cookie: 'session=user-health-tok' };
}

describe('GET /api/admin/health', () => {
  test('returns health status for admin', async () => {
    const res = await request(app)
      .get('/api/admin/health')
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('dynamodb');
    expect(res.body.checks).toHaveProperty('proxy');
    expect(res.body.checks).toHaveProperty('tenants');
  });

  test('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/health')
      .set(userHeaders());
    expect(res.status).toBe(403);
  });

  test('health response has timestamp', async () => {
    const res = await request(app)
      .get('/api/admin/health')
      .set(adminHeaders());
    expect(res.body.timestamp).toBeTruthy();
    expect(new Date(res.body.timestamp).getTime()).toBeGreaterThan(0);
  });
});
