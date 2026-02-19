/**
 * Route Smoke Test
 * Starts the server and hits every registered API route.
 * Asserts non-404 (401/403 is fine — means the route exists).
 * For routes with known async auth issues, verifies registration only.
 */
const request = require('supertest');
const path = require('path');

// Mock AWS SDKs
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  GetItemCommand: jest.fn(),
  PutItemCommand: jest.fn(),
  QueryCommand: jest.fn(),
  DeleteItemCommand: jest.fn(),
  ScanCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
  CreateTableCommand: jest.fn(),
  DescribeTableCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue({ Items: [], Item: null }),
    }),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
  DeleteCommand: jest.fn(),
  ScanCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: '{}' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

// Mock stripe
jest.mock('stripe', () => jest.fn().mockReturnValue({
  checkout: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
}));

// Mock dockerode
jest.mock('dockerode', () => jest.fn().mockImplementation(() => ({
  listContainers: jest.fn().mockResolvedValue([]),
  getContainer: jest.fn().mockReturnValue({ inspect: jest.fn().mockResolvedValue({}) }),
})));

// Mock resend (not installed in dev)
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ id: 'test' }) },
  })),
}), { virtual: true });

// Set required env vars
process.env.NODE_ENV = 'test';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:4566';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.JWT_SECRET = 'test-secret-key';
process.env.PORTAL_URL = 'http://localhost:3000';
process.env.SES_FROM_EMAIL = 'test@test.com';
process.env.PORT = '0';

let app;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  app = require('../server');
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Route smoke tests — every route returns non-404', () => {
  // Routes that can be tested via HTTP (Express Router-based, properly async)
  const httpRoutes = [
    // Auth router
    { method: 'get', path: '/api/v1/auth/magic-link' },
    { method: 'get', path: '/api/v1/auth/session' },
    { method: 'get', path: '/api/auth/magic-link' },

    // Admin router
    { method: 'get', path: '/api/v1/admin/clients' },
    { method: 'get', path: '/api/admin/clients' },
    { method: 'get', path: '/api/admin/updates/version-catalog' },

    // Dashboard router
    { method: 'get', path: '/api/v1/dashboard/bots' },
    { method: 'get', path: '/api/dashboard/bots' },

    // Billing router
    { method: 'post', path: '/api/v1/billing/portal' },
    { method: 'post', path: '/api/billing/portal' },
    { method: 'post', path: '/api/v1/billing/change-plan' },
    { method: 'post', path: '/api/billing/change-plan' },
    { method: 'post', path: '/api/v1/billing/usage-policy' },
    { method: 'post', path: '/api/billing/usage-policy' },

    // Settings router
    { method: 'get', path: '/api/v1/settings/api-keys' },
    { method: 'get', path: '/api/settings/api-keys' },
    { method: 'get', path: '/api/v1/settings/team' },
    { method: 'get', path: '/api/v1/settings/preferences' },
    { method: 'get', path: '/api/v1/settings/backup' },
    { method: 'get', path: '/api/v1/settings/secrets' },

    // Plans (public)
    { method: 'get', path: '/api/v1/plans' },
    { method: 'get', path: '/api/plans' },

    // Signup (public)
    { method: 'post', path: '/api/signup' },
    { method: 'post', path: '/api/v1/signup' },

    // Chat proxy routes
    { method: 'post', path: '/api/chat/test-bot/send' },
    { method: 'get', path: '/api/chat/test-bot/events' },
    { method: 'get', path: '/api/chat/test-bot/history' },
    { method: 'post', path: '/api/chat/test-bot/clear' },

    // Public API v1 routes
    { method: 'get', path: '/v1/bots' },
    { method: 'post', path: '/v1/bots' },
    { method: 'delete', path: '/v1/bots/test-id' },
    { method: 'get', path: '/v1/usage' },
  ];

  httpRoutes.forEach(({ method, path: route }) => {
    test(`${method.toUpperCase()} ${route} → non-404`, async () => {
      const res = await request(app)[method](route).send({});
      expect(res.status).not.toBe(404);
    });
  });

  // Individual handler routes (team/*, keys/*) are registered via app.all()
  // Verify they exist in the Express router stack
  const registeredRoutes = [
    '/api/signup',
    '/api/team/create',
    '/api/team/invite',
    '/api/team/members',
    '/api/team/remove',
    '/api/keys/create',
    '/api/keys/list',
    '/api/keys/revoke',
    '/api/v1/signup',
    '/api/v1/team/create',
    '/api/v1/team/members',
    '/api/v1/team/remove',
    '/api/v1/keys/create',
    '/api/v1/keys/list',
    '/api/v1/keys/revoke',
  ];

  test('individual handler routes are registered in Express router', () => {
    const routePaths = app._router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.path);

    registeredRoutes.forEach(route => {
      expect(routePaths).toContain(route);
    });
  });
});
