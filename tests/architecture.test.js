/**
 * Architecture Tests - TASK-233, TASK-234, TASK-237
 * Tests shared DynamoDB client, global error handler, and error codes
 */

describe('TASK-233: Shared DynamoDB Client', () => {
  test('exports client, docClient, and TABLES', () => {
    const mod = require('../api-local/util/dynamodb.js');
    expect(mod.client).toBeDefined();
    expect(mod.docClient).toBeDefined();
    expect(mod.TABLES).toBeDefined();
  });

  test('TABLES has expected table names', () => {
    const { TABLES } = require('../api-local/util/dynamodb.js');
    expect(TABLES.TENANTS).toBe('clawops-tenants');
    expect(TABLES.SECRETS).toBe('clawops-secrets');
    expect(TABLES.BACKUPS).toBe('clawops-backups');
    expect(TABLES.USAGE).toBe('clawops-usage');
    expect(TABLES.API_KEYS).toBe('clawops-api-keys');
    expect(TABLES.TEAMS).toBe('clawops-teams');
  });

  test('no duplicate DynamoDB client creation in api-local files', () => {
    const { execSync } = require('child_process');
    const result = execSync(
      'grep -rn "new DynamoDBClient" api-local/ --include="*.js" -l',
      { cwd: __dirname + '/..', encoding: 'utf8' }
    ).trim();
    const files = result.split('\n').filter(Boolean);
    expect(files).toEqual(['api-local/util/dynamodb.js']);
  });
});

describe('TASK-234: Global Error Handler', () => {
  const { asyncHandler, globalErrorHandler, AppError } = require('../api-local/util/error-handler.js');

  test('asyncHandler catches async errors', async () => {
    const error = new Error('test error');
    const fn = async () => { throw error; };
    const handler = asyncHandler(fn);
    const next = jest.fn();
    await handler({}, {}, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('globalErrorHandler returns 500 for generic errors', () => {
    const req = { method: 'GET', path: '/test' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error('something broke');
    
    globalErrorHandler(err, req, res, () => {});
    
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Internal server error' })
    );
  });

  test('globalErrorHandler uses statusCode from AppError', () => {
    const req = { method: 'GET', path: '/test' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new AppError('Not found', 404);
    
    globalErrorHandler(err, req, res, () => {});
    
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Not found' })
    );
  });

  test('hides stack trace in production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const req = { method: 'GET', path: '/test' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error('fail');
    
    globalErrorHandler(err, req, res, () => {});
    
    const response = res.json.mock.calls[0][0];
    expect(response.stack).toBeUndefined();
    
    process.env.NODE_ENV = origEnv;
  });
});

describe('TASK-237: Error Codes', () => {
  const { ERROR_CODES, apiError } = require('../api-local/util/error-codes.js');

  test('ERROR_CODES has required entries', () => {
    expect(ERROR_CODES.AUTH_REQUIRED).toBeDefined();
    expect(ERROR_CODES.AUTH_REQUIRED.status).toBe(401);
    expect(ERROR_CODES.AUTH_REQUIRED.code).toBe('AUTH_REQUIRED');
    expect(ERROR_CODES.ADMIN_REQUIRED.status).toBe(403);
    expect(ERROR_CODES.NOT_FOUND.status).toBe(404);
    expect(ERROR_CODES.RATE_LIMITED.status).toBe(429);
    expect(ERROR_CODES.INTERNAL.status).toBe(500);
  });

  test('apiError returns proper format', () => {
    const result = apiError(ERROR_CODES.AUTH_REQUIRED);
    expect(result).toEqual({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  });

  test('apiError hides details in production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const result = apiError(ERROR_CODES.INTERNAL, 'secret details');
    expect(result.details).toBeUndefined();
    
    process.env.NODE_ENV = origEnv;
  });

  test('apiError shows details in development', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    const result = apiError(ERROR_CODES.INTERNAL, 'debug info');
    expect(result.details).toBe('debug info');
    
    process.env.NODE_ENV = origEnv;
  });
});
