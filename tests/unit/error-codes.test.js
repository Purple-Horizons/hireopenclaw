const { ERROR_CODES, apiError } = require('../../api-local/util/error-codes');

describe('ERROR_CODES', () => {
  test('all codes have required fields', () => {
    for (const [key, def] of Object.entries(ERROR_CODES)) {
      expect(def).toHaveProperty('code');
      expect(def).toHaveProperty('status');
      expect(def).toHaveProperty('message');
      expect(typeof def.code).toBe('string');
      expect(typeof def.status).toBe('number');
      expect(typeof def.message).toBe('string');
      expect(def.status).toBeGreaterThanOrEqual(400);
      expect(def.status).toBeLessThan(600);
    }
  });
});

describe('apiError', () => {
  test('formats error correctly', () => {
    const result = apiError(ERROR_CODES.AUTH_REQUIRED);
    expect(result).toEqual({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  });

  test('includes details in development mode', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const result = apiError(ERROR_CODES.INVALID_INPUT, 'bad field');
    expect(result.details).toBe('bad field');
    process.env.NODE_ENV = origEnv;
  });

  test('hides details in production mode', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const result = apiError(ERROR_CODES.INVALID_INPUT, 'bad field');
    expect(result.details).toBeUndefined();
    process.env.NODE_ENV = origEnv;
  });

  test('no details key when details not provided', () => {
    const result = apiError(ERROR_CODES.NOT_FOUND);
    expect(result).not.toHaveProperty('details');
  });
});
