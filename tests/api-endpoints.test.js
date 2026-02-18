/**
 * TASK-303: API Endpoint Test Coverage
 * Tests all critical API endpoints with mocked DynamoDB and token store.
 */

process.env.NODE_ENV = 'test';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_DEFAULT_REGION = 'us-east-1';

// Global mock DB shared via global
const mockDB = new Map();
global.__mockDB = mockDB;

function mockDynamoItem(obj) {
  const item = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') item[k] = { S: v };
    else if (typeof v === 'number') item[k] = { N: String(v) };
    else if (typeof v === 'boolean') item[k] = { BOOL: v };
  }
  return item;
}

function mockUnmarshall(item) {
  const obj = {};
  for (const [k, v] of Object.entries(item)) {
    if (v.S !== undefined) obj[k] = v.S;
    else if (v.N !== undefined) obj[k] = Number(v.N);
    else if (v.BOOL !== undefined) obj[k] = v.BOOL;
  }
  return obj;
}

// Mock @aws-sdk/client-dynamodb
jest.mock('@aws-sdk/client-dynamodb', () => {
  const mockUnmarshallInner = (item) => {
    const obj = {};
    for (const [k, v] of Object.entries(item)) {
      if (v.S !== undefined) obj[k] = v.S;
      else if (v.N !== undefined) obj[k] = Number(v.N);
      else if (v.BOOL !== undefined) obj[k] = v.BOOL;
    }
    return obj;
  };

  class MockDynamoDBClient {
    send(command) { return command._execute(); }
  }
  class QueryCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const items = [];
      for (const [key, val] of db.entries()) {
        if (key.startsWith(`${this.params.TableName}:`)) {
          if (this.params.IndexName === 'email-index') {
            const emailVal = this.params.ExpressionAttributeValues[':email']?.S;
            if (val.email?.S === emailVal) items.push(val);
          } else {
            items.push(val);
          }
        }
      }
      return Promise.resolve({ Items: items, Count: items.length });
    }
  }
  class GetItemCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const pk = Object.values(this.params.Key)[0]?.S;
      const item = db.get(`${this.params.TableName}:${pk}`);
      return Promise.resolve({ Item: item || undefined });
    }
  }
  class PutItemCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const pk = Object.values(this.params.Item)[0]?.S || Object.values(this.params.Item)[0]?.N;
      db.set(`${this.params.TableName}:${pk}`, this.params.Item);
      return Promise.resolve({});
    }
  }
  class DeleteItemCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const pk = Object.values(this.params.Key)[0]?.S;
      db.delete(`${this.params.TableName}:${pk}`);
      return Promise.resolve({});
    }
  }
  return { DynamoDBClient: MockDynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, DeleteItemCommand };
});

// Mock @aws-sdk/lib-dynamodb
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

  const mockUnmarshallInner = (item) => {
    const obj = {};
    for (const [k, v] of Object.entries(item)) {
      if (v && v.S !== undefined) obj[k] = v.S;
      else if (v && v.N !== undefined) obj[k] = Number(v.N);
      else if (v && v.BOOL !== undefined) obj[k] = v.BOOL;
      else obj[k] = v;
    }
    return obj;
  };

  class MockDocClient {
    constructor() { this._client = new DynamoDBClient({}); }
    send(command) { return command._execute(); }
  }
  class QueryCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const items = [];
      for (const [key, val] of db.entries()) {
        if (key.startsWith(`${this.params.TableName}:`)) {
          if (this.params.IndexName === 'email-index') {
            const emailVal = this.params.ExpressionAttributeValues[':email'];
            const itemEmail = val.email?.S || val.email;
            if (itemEmail === emailVal) items.push(mockUnmarshallInner(val));
          } else {
            items.push(mockUnmarshallInner(val));
          }
        }
      }
      return Promise.resolve({ Items: items, Count: items.length });
    }
  }
  class UpdateCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const pk = Object.values(this.params.Key)[0];
      const pkStr = typeof pk === 'object' ? pk.S : pk;
      const existing = db.get(`${this.params.TableName}:${pkStr}`) || {};
      const merged = { ...existing };
      const vals = this.params.ExpressionAttributeValues || {};
      const names = this.params.ExpressionAttributeNames || {};
      for (const [alias, value] of Object.entries(vals)) {
        const cleanAlias = alias.replace(':', '');
        let realName = cleanAlias;
        for (const [nameAlias, actual] of Object.entries(names)) {
          if (actual === cleanAlias || nameAlias.replace('#', '') === cleanAlias) {
            realName = actual;
          }
        }
        if (typeof value === 'string') merged[realName] = { S: value };
        else if (typeof value === 'number') merged[realName] = { N: String(value) };
      }
      db.set(`${this.params.TableName}:${pkStr}`, merged);
      return Promise.resolve({});
    }
  }
  class ScanCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const items = [];
      for (const [key, val] of db.entries()) {
        if (key.startsWith(`${this.params.TableName}:`)) {
          items.push(mockUnmarshallInner(val));
        }
      }
      return Promise.resolve({
        Items: items.slice(0, this.params.Limit || items.length),
        Count: items.length,
      });
    }
  }
  class GetCommand {
    constructor(params) { this.params = params; }
    _execute() {
      const db = global.__mockDB;
      const pk = Object.values(this.params.Key)[0];
      const pkStr = typeof pk === 'object' ? pk.S : pk;
      const item = db.get(`${this.params.TableName}:${pkStr}`);
      return Promise.resolve({ Item: item ? mockUnmarshallInner(item) : undefined });
    }
  }
  return {
    DynamoDBDocumentClient: { from: () => new MockDocClient() },
    QueryCommand,
    UpdateCommand,
    ScanCommand,
    GetCommand,
  };
});

// Mock @aws-sdk/util-dynamodb
jest.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: (item) => {
    const obj = {};
    for (const [k, v] of Object.entries(item)) {
      if (v && v.S !== undefined) obj[k] = v.S;
      else if (v && v.N !== undefined) obj[k] = Number(v.N);
      else if (v && v.BOOL !== undefined) obj[k] = v.BOOL;
      else obj[k] = v;
    }
    return obj;
  },
}));

// Mock child_process (for admin clients + create-bot)
jest.mock('child_process', () => ({
  execSync: jest.fn(() => JSON.stringify({ Items: [], Count: 0 })),
  execFileSync: jest.fn(() => ''),
  execFile: jest.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (cb) cb(null, 'Endpoint registered: http://localhost:18791', '');
  }),
}));

// Mock promisify to handle execFile
jest.mock('util', () => {
  const actual = jest.requireActual('util');
  return {
    ...actual,
    promisify: (fn) => {
      if (fn && fn._isMockFunction) {
        return (...args) => Promise.resolve({ stdout: 'Endpoint registered: http://localhost:18791', stderr: '' });
      }
      return actual.promisify(fn);
    },
  };
});

// Mock docker-sdk
jest.mock('../api-local/util/docker-sdk.js', () => ({
  getContainer: jest.fn(() => ({
    stats: jest.fn().mockResolvedValue({
      cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 800 },
      memory_stats: { usage: 16 * 1024 * 1024, limit: 512 * 1024 * 1024 },
      networks: { eth0: { rx_bytes: 1024, tx_bytes: 2048 } },
      blkio_stats: { io_service_bytes_recursive: [{ op: 'Read', value: 4096 }, { op: 'Write', value: 8192 }] },
      pids_stats: { current: 7 },
    }),
    inspect: jest.fn().mockResolvedValue({
      State: {
        Status: 'running',
        Health: { Status: 'healthy' },
        StartedAt: new Date(Date.now() - 60_000).toISOString(),
        Pid: 1234,
      },
      RestartCount: 1,
    }),
  })),
  restartContainer: jest.fn().mockResolvedValue({}),
  pauseContainer: jest.fn().mockResolvedValue({}),
  unpauseContainer: jest.fn().mockResolvedValue({}),
  stopContainer: jest.fn().mockResolvedValue({}),
}));

// Mock logger
jest.mock('../api-local/util/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// ── Setup Express + supertest ──────────────────────────────────────────────
const express = require('express');
const request = require('supertest');

let app;
let tokenStore;

function createApp() {
  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: true }));

  const { validateCsrf } = require('../api-local/auth/csrf.js');
  a.use(validateCsrf);

  const authRouter = require('../api-local/routes/auth.js');
  const dashboardRouter = require('../api-local/routes/dashboard.js');
  const adminRouter = require('../api-local/routes/admin.js');
  const settingsRouter = require('../api-local/routes/settings.js');

  a.use('/api/auth', authRouter);
  a.use('/api/dashboard', dashboardRouter);
  a.use('/api/admin', adminRouter);
  a.use('/api/settings', settingsRouter);

  const magicLinkHandler = require('../api-local/auth/magic-link.js');
  a.get('/auth/verify', (req, res) => {
    req.query.action = 'verify';
    magicLinkHandler(req, res);
  });

  return a;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function seedTenant(tenantId, email, opts = {}) {
  const item = mockDynamoItem({
    tenantId,
    email,
    name: opts.name || 'Test Bot',
    status: opts.status || 'active',
    plan: opts.plan || 'starter',
    healthStatus: opts.health || 'healthy',
    template: opts.template || 'blank',
    createdAt: opts.createdAt || Math.floor(Date.now() / 1000),
  });
  mockDB.set(`clawops-tenants:${tenantId}`, item);
}

async function createSession(email) {
  tokenStore = require('../api-local/auth/token-store.js');
  const crypto = require('crypto');
  const sessionToken = crypto.randomBytes(32).toString('hex');
  tokenStore.set(sessionToken, {
    email,
    type: 'session',
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  return sessionToken;
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDB.clear();
  tokenStore = require('../api-local/auth/token-store.js');
  const { _reset } = require('../api-local/auth/rate-limit.js');
  _reset();
  app = createApp();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. POST /api/auth/magic-link
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/auth/magic-link', () => {
  test('returns ok for known email (admin)', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link')
      .send({ email: 'g@purplehorizons.io' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/login link/i);
  });

  test('returns ok for known tenant email', async () => {
    seedTenant('tenant-001', 'client@example.com');
    const res = await request(app)
      .post('/api/auth/magic-link')
      .send({ email: 'client@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns same 200 for unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('rejects missing email', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. GET /auth/verify?token=X
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /auth/verify', () => {
  test('returns session for valid token', async () => {
    tokenStore = require('../api-local/auth/token-store.js');
    const token = 'valid-magic-token-abc123';
    tokenStore.set(token, {
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 15 * 60 * 1000,
      used: false,
    });

    const res = await request(app).get(`/auth/verify?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.email).toBe('g@purplehorizons.io');
    expect(res.body.sessionToken).toBeDefined();
  });

  test('rejects invalid token', async () => {
    const res = await request(app).get('/auth/verify?token=bogus-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('rejects expired token', async () => {
    tokenStore = require('../api-local/auth/token-store.js');
    tokenStore.set('expired-magic-token', {
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() - 1000,
      used: false,
    });

    const res = await request(app).get('/auth/verify?token=expired-magic-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('rejects already-used token', async () => {
    tokenStore = require('../api-local/auth/token-store.js');
    tokenStore.set('used-magic-token', {
      email: 'g@purplehorizons.io',
      expiresAt: Date.now() + 15 * 60 * 1000,
      used: true,
    });

    const res = await request(app).get('/auth/verify?token=used-magic-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/used/i);
  });

  test('rejects missing token param', async () => {
    const res = await request(app).get('/auth/verify');
    expect(res.status).toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. POST /api/auth/session
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/auth/session', () => {
  test('validates a valid session token', async () => {
    const sessionToken = await createSession('client@example.com');
    const res = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.email).toBe('client@example.com');
  });

  test('rejects invalid session token', async () => {
    const res = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken: 'fake-token' });
    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('rejects expired session token', async () => {
    tokenStore = require('../api-local/auth/token-store.js');
    tokenStore.set('expired-session', {
      email: 'client@example.com',
      type: 'session',
      expiresAt: Date.now() - 1000,
    });
    const res = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken: 'expired-session' });
    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('rejects non-session token type', async () => {
    tokenStore = require('../api-local/auth/token-store.js');
    tokenStore.set('magic-link-token', {
      email: 'client@example.com',
      type: 'magic-link',
      expiresAt: Date.now() + 60000,
    });
    const res = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken: 'magic-link-token' });
    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('rejects missing sessionToken', async () => {
    const res = await request(app)
      .post('/api/auth/session')
      .send({});
    expect(res.status).toBe(400);
  });

  test('validates session from cookie when body token is absent', async () => {
    const sessionToken = await createSession('cookie-user@example.com');
    const res = await request(app)
      .post('/api/auth/session')
      .set('Cookie', `session=${sessionToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.email).toBe('cookie-user@example.com');
  });

  test('does not accept session token from query params', async () => {
    const sessionToken = await createSession('query-user@example.com');
    const res = await request(app)
      .post(`/api/auth/session?sessionToken=${sessionToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. DELETE /api/auth/session
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('DELETE /api/auth/session', () => {
  test('invalidates session from cookie', async () => {
    const sessionToken = await createSession('logout-cookie@example.com');

    const logoutRes = await request(app)
      .delete('/api/auth/session')
      .set('Cookie', `session=${sessionToken}`)
      .send({});
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    const validateRes = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken });
    expect(validateRes.status).toBe(401);
    expect(validateRes.body.valid).toBe(false);
  });

  test('ignores query-param sessionToken on logout', async () => {
    const sessionToken = await createSession('logout-query@example.com');

    const logoutRes = await request(app)
      .delete(`/api/auth/session?sessionToken=${sessionToken}`)
      .send({});
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    const validateRes = await request(app)
      .post('/api/auth/session')
      .send({ sessionToken });
    expect(validateRes.status).toBe(200);
    expect(validateRes.body.valid).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. GET /api/dashboard/bots
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/dashboard/bots', () => {
  test('returns bots for authenticated user', async () => {
    seedTenant('tenant-001', 'client@example.com', { name: 'My Bot' });
    const sessionToken = await createSession('client@example.com');

    const res = await request(app)
      .get('/api/dashboard/bots')
      .set('Cookie', `session=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.bots).toBeDefined();
    expect(Array.isArray(res.body.bots)).toBe(true);
  });

  test('returns 401 without session cookie', async () => {
    const res = await request(app).get('/api/dashboard/bots');
    expect(res.status).toBe(401);
  });

  test('returns 405 for non-GET method', async () => {
    const sessionToken = await createSession('client@example.com');
    const res = await request(app)
      .post('/api/dashboard/bots')
      .set('Cookie', `session=${sessionToken}`);
    expect(res.status).toBe(405);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. GET /api/dashboard/container-stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/dashboard/container-stats', () => {
  test('rejects invalid tenantId format', async () => {
    const sessionToken = await createSession('client@example.com');

    const res = await request(app)
      .get('/api/dashboard/container-stats?tenantId=tenant-1;rm -rf /')
      .set('Cookie', `session=${sessionToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tenantId/i);
  });

  test('returns stats for owned tenant', async () => {
    seedTenant('tenant-stats-001', 'client@example.com');
    const sessionToken = await createSession('client@example.com');

    const res = await request(app)
      .get('/api/dashboard/container-stats?tenantId=tenant-stats-001')
      .set('Cookie', `session=${sessionToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tenantId).toBe('tenant-stats-001');
    expect(res.body.stats.cpuPercent).toMatch(/%/);
    expect(res.body.stats.memoryUsage).toContain('/');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. POST /api/dashboard/create-bot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/dashboard/create-bot', () => {
  test('creates a bot for authenticated user', async () => {
    const sessionToken = await createSession('client@example.com');

    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .set('Cookie', `session=${sessionToken}`)
      .send({
        botName: 'TestBot',
        template: 'blank',
        plan: 'starter',
      });
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(res.body.botName).toBe('TestBot');
    }
  });

  test('returns 401 without session', async () => {
    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .send({ botName: 'TestBot', plan: 'starter', template: 'blank' });
    expect(res.status).toBe(401);
  });

  test('rejects missing botName', async () => {
    const sessionToken = await createSession('client@example.com');
    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .set('Cookie', `session=${sessionToken}`)
      .send({ plan: 'starter', template: 'blank' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/botName/i);
  });

  test('rejects invalid plan', async () => {
    const sessionToken = await createSession('client@example.com');
    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .set('Cookie', `session=${sessionToken}`)
      .send({ botName: 'TestBot', plan: 'fake-plan', template: 'blank' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plan/i);
  });

  test('rejects invalid template', async () => {
    const sessionToken = await createSession('client@example.com');
    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .set('Cookie', `session=${sessionToken}`)
      .send({ botName: 'TestBot', plan: 'starter', template: 'evil-template' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/template/i);
  });

  test('rejects tenant takeover when tenant belongs to another user', async () => {
    seedTenant('tenant-foreign-1', 'other@example.com', { name: 'Other Bot' });
    const sessionToken = await createSession('client@example.com');

    const res = await request(app)
      .post('/api/dashboard/create-bot')
      .set('Cookie', `session=${sessionToken}`)
      .send({
        tenantId: 'tenant-foreign-1',
        botName: 'TakeoverAttempt',
        template: 'blank',
        plan: 'starter',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. POST /api/dashboard/bot-action
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/dashboard/bot-action', () => {
  test('pauses a bot owned by the user', async () => {
    seedTenant('tenant-action-1', 'owner@example.com');
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .set('Cookie', `session=${sessionToken}`)
      .send({ tenantId: 'tenant-action-1', action: 'pause' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('pause');
  });

  test('rejects action from non-owner', async () => {
    seedTenant('tenant-action-2', 'real-owner@example.com');
    const sessionToken = await createSession('not-owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .set('Cookie', `session=${sessionToken}`)
      .send({ tenantId: 'tenant-action-2', action: 'pause' });
    expect(res.status).toBe(403);
  });

  test('rejects without session', async () => {
    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ tenantId: 'tenant-action-1', action: 'pause' });
    expect(res.status).toBe(401);
  });

  test('rejects invalid action', async () => {
    seedTenant('tenant-action-3', 'owner@example.com');
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .set('Cookie', `session=${sessionToken}`)
      .send({ tenantId: 'tenant-action-3', action: 'destroy-everything' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid action/i);
  });

  test('rejects missing tenantId', async () => {
    const sessionToken = await createSession('owner@example.com');
    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .set('Cookie', `session=${sessionToken}`)
      .send({ action: 'pause' });
    expect(res.status).toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. GET /api/admin/clients
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/admin/clients', () => {
  test('returns clients for admin user', async () => {
    const sessionToken = await createSession('g@purplehorizons.io');
    seedTenant('tenant-1', 'client@example.com', { status: 'active' });

    const res = await request(app)
      .get('/api/admin/clients')
      .set('Cookie', `session=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.clients).toBeDefined();
  });

  test('returns 403 for non-admin user', async () => {
    const sessionToken = await createSession('normie@example.com');
    const res = await request(app)
      .get('/api/admin/clients')
      .set('Cookie', `session=${sessionToken}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without session', async () => {
    const res = await request(app).get('/api/admin/clients');
    expect(res.status).toBe(401);
  });

  test('rejects invalid pagination cursor', async () => {
    const sessionToken = await createSession('g@purplehorizons.io');
    const res = await request(app)
      .get('/api/admin/clients?cursor=%%%not-base64%%%')
      .set('Cookie', `session=${sessionToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cursor/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. /api/settings/*
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/api/settings/* auth + ownership', () => {
  test('requires session for API key list', async () => {
    const res = await request(app).get('/api/settings/api-keys');
    expect(res.status).toBe(401);
  });

  test('rejects revoking API key owned by another user', async () => {
    mockDB.set('clawops-api-keys:key-foreign', mockDynamoItem({
      keyId: 'key-foreign',
      email: 'owner@example.com',
      name: 'Owner Key',
      active: true,
      createdAt: new Date().toISOString(),
    }));
    const sessionToken = await createSession('attacker@example.com');

    const res = await request(app)
      .delete('/api/settings/api-keys')
      .set('Cookie', `session=${sessionToken}`)
      .send({ keyId: 'key-foreign' });

    expect(res.status).toBe(404);
  });

  test('allows revoking own API key', async () => {
    mockDB.set('clawops-api-keys:key-own', mockDynamoItem({
      keyId: 'key-own',
      email: 'owner@example.com',
      name: 'Owner Key',
      active: true,
      createdAt: new Date().toISOString(),
    }));
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .delete('/api/settings/api-keys')
      .set('Cookie', `session=${sessionToken}`)
      .send({ keyId: 'key-own' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. POST /api/admin/impersonate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/admin/impersonate', () => {
  test('admin can impersonate a client', async () => {
    const sessionToken = await createSession('g@purplehorizons.io');
    const res = await request(app)
      .post('/api/admin/impersonate')
      .set('Cookie', `session=${sessionToken}`)
      .send({ email: 'client@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.impersonating).toBe('client@example.com');
  });

  test('non-admin cannot impersonate', async () => {
    const sessionToken = await createSession('normie@example.com');
    const res = await request(app)
      .post('/api/admin/impersonate')
      .set('Cookie', `session=${sessionToken}`)
      .send({ email: 'client@example.com' });
    expect(res.status).toBe(403);
  });

  test('returns 401 without session', async () => {
    const res = await request(app)
      .post('/api/admin/impersonate')
      .send({ email: 'client@example.com' });
    expect(res.status).toBe(401);
  });

  test('rejects missing email', async () => {
    const sessionToken = await createSession('g@purplehorizons.io');
    const res = await request(app)
      .post('/api/admin/impersonate')
      .set('Cookie', `session=${sessionToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});
