/**
 * Security Tests — TASK-204 & TASK-205
 * 
 * TASK-204: Encryption key enforcement
 * TASK-205: CLI bypass restrictions
 */

// ─── TASK-205: CLI Bypass Tests ───

describe('CLI Admin Bypass (TASK-205)', () => {
  let requireAdmin, res, req;

  beforeEach(() => {
    // Fresh require each time to pick up env changes
    jest.resetModules();
    delete process.env.NODE_ENV;
    delete process.env.CLI_SECRET;

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  function loadMiddleware() {
    return require('../api-local/auth/middleware.js');
  }

  test('CLI bypass rejected when no CLI_SECRET env var set', async () => {
    process.env.NODE_ENV = 'development';
    // No CLI_SECRET set
    const { requireAdmin } = loadMiddleware();
    req = { headers: { 'x-cli-secret': 'anything', cookie: '' } };
    const result = await requireAdmin(req, res);
    expect(result).toBeNull();
    expect(req.isAdmin).toBeUndefined();
  });

  test('CLI bypass rejected in production mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLI_SECRET = 'my-secret';
    const { requireAdmin } = loadMiddleware();
    req = { headers: { 'x-cli-secret': 'my-secret', cookie: '' } };
    const result = await requireAdmin(req, res);
    expect(result).toBeNull();
    expect(req.isCLI).toBeUndefined();
  });

  test('CLI bypass works with correct secret in dev mode', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CLI_SECRET = 'test-secret-123';
    const { requireAdmin } = loadMiddleware();
    req = { headers: { 'x-cli-secret': 'test-secret-123', cookie: '' }, ip: '127.0.0.1' };
    const result = await requireAdmin(req, res);
    expect(result).toBe('cli@localhost');
    expect(req.isAdmin).toBe(true);
    expect(req.isCLI).toBe(true);
  });

  test('CLI bypass rejected with wrong secret', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CLI_SECRET = 'correct-secret';
    const { requireAdmin } = loadMiddleware();
    req = { headers: { 'x-cli-secret': 'wrong-secret', cookie: '' } };
    const result = await requireAdmin(req, res);
    expect(result).toBeNull();
  });
});

// ─── TASK-204: Encryption Key Tests ───

describe('Encryption Key Enforcement (TASK-204)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('warns in dev mode when no encryption key set', () => {
    process.env.NODE_ENV = 'development';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    require('../api-local/admin/secrets.js');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Using default encryption key')
    );
    warnSpy.mockRestore();
  });

  test('crashes in production when no encryption key set', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    expect(() => require('../api-local/admin/secrets.js')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SECRETS_ENCRYPTION_KEY must be set'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('no warning when encryption key is set', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'my-secure-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    require('../api-local/admin/secrets.js');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
