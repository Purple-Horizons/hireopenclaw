process.env.NODE_ENV = 'test';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_DEFAULT_REGION = 'us-east-1';
process.env.ADMIN_EMAILS = 'g@purplehorizons.io';

const request = require('supertest');
const tokenStore = require('../api-local/auth/token-store.js');

let app;
beforeAll(() => {
  const http = require('http');
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function () { return this; };
  app = require('../server');
  http.Server.prototype.listen = originalListen;

  tokenStore.set('admin-rev-tok', {
    email: 'g@purplehorizons.io',
    type: 'session',
    expiresAt: Date.now() + 86400000,
  });
  tokenStore.set('user-rev-tok', {
    email: 'nobody@example.com',
    type: 'session',
    expiresAt: Date.now() + 86400000,
  });
});

function adminHeaders() {
  return { 'x-csrf-token': 'test', Cookie: 'session=admin-rev-tok' };
}

describe('GET /api/admin/revenue', () => {
  test('returns revenue data for admin', async () => {
    const res = await request(app)
      .get('/api/admin/revenue')
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mrr');
    expect(res.body).toHaveProperty('totalCost');
    expect(res.body).toHaveProperty('margin');
    expect(res.body).toHaveProperty('marginPercent');
    expect(res.body).toHaveProperty('breakdown');
    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('rates');
    expect(typeof res.body.mrr).toBe('number');
    expect(Array.isArray(res.body.breakdown)).toBe(true);
  });

  test('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/revenue')
      .set({ 'x-csrf-token': 'test', Cookie: 'session=user-rev-tok' });
    expect(res.status).toBe(403);
  });

  test('rate fields are present', async () => {
    const res = await request(app)
      .get('/api/admin/revenue')
      .set(adminHeaders());
    expect(res.body.rates.inputPerM).toBe(3);
    expect(res.body.rates.outputPerM).toBe(15);
  });
});
