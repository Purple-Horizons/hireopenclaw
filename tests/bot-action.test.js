/**
 * Bot Action DB Sync Tests
 * Tests bot-action.js DB status updates for all action types
 */

process.env.NODE_ENV = 'test';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_DEFAULT_REGION = 'us-east-1';

// Global mock DB
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

// Mock @aws-sdk/client-dynamodb
jest.mock('@aws-sdk/client-dynamodb', () => {
  class MockDynamoDBClient {
    send(command) { return command._execute(); }
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
  return { DynamoDBClient: MockDynamoDBClient, GetItemCommand, PutItemCommand };
});

// Mock @aws-sdk/lib-dynamodb
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockUnmarshall = (item) => {
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
    send(command) { return command._execute(); }
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
          if (nameAlias.replace('#', '') === cleanAlias) {
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
  return {
    DynamoDBDocumentClient: { from: () => new MockDocClient() },
    UpdateCommand,
  };
});

// Mock docker-sdk
const mockDockerSdk = {
  pauseContainer: jest.fn().mockResolvedValue({}),
  unpauseContainer: jest.fn().mockResolvedValue({}),
  restartContainer: jest.fn().mockResolvedValue({}),
  stopContainer: jest.fn().mockResolvedValue({}),
};
jest.mock('../api-local/util/docker-sdk.js', () => mockDockerSdk);

// Mock logger
jest.mock('../api-local/util/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock CSRF
jest.mock('../api-local/auth/csrf.js', () => ({
  validateCsrf: (req, res, next) => next(),
}));

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

  const dashboardRouter = require('../api-local/routes/dashboard.js');
  a.use('/api/dashboard', dashboardRouter);

  return a;
}

function seedTenant(tenantId, email, opts = {}) {
  const item = mockDynamoItem({
    tenantId,
    email,
    name: opts.name || 'Test Bot',
    status: opts.status || 'active',
    plan: opts.plan || 'starter',
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

function getDbStatus(tenantId) {
  const item = mockDB.get(`clawops-tenants:${tenantId}`);
  if (!item) return null;
  return item.status?.S || item.status;
}

beforeEach(() => {
  mockDB.clear();
  tokenStore = require('../api-local/auth/token-store.js');
  jest.clearAllMocks();
  
  // Reset docker-sdk mocks to default successful behavior
  mockDockerSdk.pauseContainer.mockResolvedValue({});
  mockDockerSdk.unpauseContainer.mockResolvedValue({});
  mockDockerSdk.restartContainer.mockResolvedValue({});
  mockDockerSdk.stopContainer.mockResolvedValue({});
  
  app = createApp();
});

describe('Bot Action DB Sync', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Pause sets DB status to 'paused'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('pause sets DB status to paused', async () => {
    seedTenant('tenant-pause', 'owner@example.com', { status: 'active' });
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-pause', action: 'pause' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('paused');
    expect(mockDockerSdk.pauseContainer).toHaveBeenCalledWith('clawops-tenant-pause');
    
    const dbStatus = getDbStatus('tenant-pause');
    expect(dbStatus).toBe('paused');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Resume sets DB status to 'active'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('resume sets DB status to active', async () => {
    seedTenant('tenant-resume', 'owner@example.com', { status: 'paused' });
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-resume', action: 'resume' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('active');
    expect(mockDockerSdk.unpauseContainer).toHaveBeenCalledWith('clawops-tenant-resume');
    
    const dbStatus = getDbStatus('tenant-resume');
    expect(dbStatus).toBe('active');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. Restart sets DB status to 'active'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('restart sets DB status to active', async () => {
    seedTenant('tenant-restart', 'owner@example.com', { status: 'active' });
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-restart', action: 'restart' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('active');
    expect(mockDockerSdk.restartContainer).toHaveBeenCalledWith('clawops-tenant-restart');
    
    const dbStatus = getDbStatus('tenant-restart');
    expect(dbStatus).toBe('active');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. Terminate sets DB status to 'terminated'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('terminate sets DB status to terminated', async () => {
    seedTenant('tenant-term', 'owner@example.com', { status: 'active' });
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-term', action: 'terminate' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('terminated');
    expect(mockDockerSdk.stopContainer).toHaveBeenCalledWith('clawops-tenant-term');
    
    const dbStatus = getDbStatus('tenant-term');
    expect(dbStatus).toBe('terminated');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. Already-paused returns 200 and syncs DB to 'paused'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('already-paused returns 200 and syncs DB to paused', async () => {
    seedTenant('tenant-already-paused', 'owner@example.com', { status: 'active' });
    const sessionToken = await createSession('owner@example.com');
    
    // Mock Docker error for already-paused container
    mockDockerSdk.pauseContainer.mockRejectedValueOnce(
      new Error('Container already paused')
    );

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-already-paused', action: 'pause' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('paused');
    expect(res.body.message).toMatch(/already paused/i);
    
    const dbStatus = getDbStatus('tenant-already-paused');
    expect(dbStatus).toBe('paused');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. Not-paused (resume on running) returns 200 and syncs DB to 'active'
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('not-paused (resume on running) returns 200 and syncs DB to active', async () => {
    seedTenant('tenant-not-paused', 'owner@example.com', { status: 'paused' });
    const sessionToken = await createSession('owner@example.com');
    
    // Mock Docker error for container not paused
    mockDockerSdk.unpauseContainer.mockRejectedValueOnce(
      new Error('Container is not paused')
    );

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-not-paused', action: 'resume' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('active');
    expect(res.body.message).toMatch(/already running/i);
    
    const dbStatus = getDbStatus('tenant-not-paused');
    expect(dbStatus).toBe('active');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. Requires valid sessionToken (401 without)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('requires valid sessionToken (401 without)', async () => {
    seedTenant('tenant-auth', 'owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ tenantId: 'tenant-auth', action: 'pause' });

    expect(res.status).toBe(401);
    expect(mockDockerSdk.pauseContainer).not.toHaveBeenCalled();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. Rejects non-owner (403)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('rejects non-owner (403)', async () => {
    seedTenant('tenant-ownership', 'real-owner@example.com');
    const sessionToken = await createSession('hacker@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-ownership', action: 'pause' });

    expect(res.status).toBe(403);
    expect(mockDockerSdk.pauseContainer).not.toHaveBeenCalled();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. Rejects invalid action (400)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('rejects invalid action (400)', async () => {
    seedTenant('tenant-badaction', 'owner@example.com');
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, tenantId: 'tenant-badaction', action: 'selfdestruct' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid action/i);
    expect(mockDockerSdk.pauseContainer).not.toHaveBeenCalled();
    expect(mockDockerSdk.unpauseContainer).not.toHaveBeenCalled();
    expect(mockDockerSdk.restartContainer).not.toHaveBeenCalled();
    expect(mockDockerSdk.stopContainer).not.toHaveBeenCalled();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. Rejects missing tenantId (400)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  test('rejects missing tenantId (400)', async () => {
    const sessionToken = await createSession('owner@example.com');

    const res = await request(app)
      .post('/api/dashboard/bot-action')
      .send({ sessionToken, action: 'pause' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tenantId/i);
    expect(mockDockerSdk.pauseContainer).not.toHaveBeenCalled();
  });
});
