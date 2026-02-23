describe('Vercel Express entrypoint', () => {
  let app;
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '0';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = require('../api/index.js');
  });

  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('can require Express app from Vercel entrypoint', () => {
    expect(app).toBeTruthy();
    expect(typeof app).toBe('function');
  });

  test('GET /api/auth/csrf is handled by Express app', async () => {
    const layer = app._router.stack.find(
      entry => entry.route && entry.route.path === '/api/auth/csrf',
    );
    expect(layer).toBeTruthy();

    const handler = layer.route.stack[0].handle;
    const req = {
      headers: {},
      method: 'GET',
      path: '/api/auth/csrf',
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'No session' });
  });
});
