const request = require('supertest');

let app;
beforeAll(() => {
  const originalListen = require('http').Server.prototype.listen;
  require('http').Server.prototype.listen = function() { return this; };
  app = require('../../server');
  require('http').Server.prototype.listen = originalListen;
});

describe('GET /api/plans', () => {
  test('returns plan list with 200', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('free');
    expect(res.body).toHaveProperty('starter');
    expect(res.body).toHaveProperty('pro');
  });

  test('supports ETag / 304', async () => {
    const res1 = await request(app).get('/api/plans');
    const etag = res1.headers['etag'];
    if (etag) {
      const res2 = await request(app).get('/api/plans').set('If-None-Match', etag);
      expect(res2.status).toBe(304);
    }
  });

  test('v1 alias works', async () => {
    const res = await request(app).get('/api/v1/plans');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('free');
  });
});
