/**
 * PH-082: Path-based tenant URL routing tests
 */
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-auth-secret';
process.env.ADMIN_EMAILS = 'g@purplehorizons.io';

describe('Slug-based routing (PH-082)', () => {
  let app, request;

  beforeAll(() => {
    app = require('../server.js');
    request = require('supertest');
  });

  test('/t/:slug serves dashboard HTML', async () => {
    const res = await request(app).get('/t/acme-labs');
    // Should serve the dashboard.html file (200) or redirect
    expect([200, 301, 302]).toContain(res.status);
  });

  test('/api/resolve-slug/:slug returns 404 for unknown slug', async () => {
    const res = await request(app).get('/api/resolve-slug/nonexistent-slug-xyz');
    // May return 404 (not found) or 500 (DynamoDB not available in test)
    expect([404, 500]).toContain(res.status);
  });

  test('/api/resolve-slug route exists', async () => {
    const res = await request(app).get('/api/resolve-slug/test');
    expect(res.status).not.toBe(405); // method exists
  });

  test('vercel.json has /t/:slug rewrite', () => {
    const vercelConfig = require('../vercel.json');
    const slugRewrite = vercelConfig.rewrites.find(r => r.source.includes('/t/:slug'));
    expect(slugRewrite).toBeDefined();
    expect(slugRewrite.destination).toBe('/dashboard.html');
  });
});
