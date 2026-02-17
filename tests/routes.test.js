/**
 * Route Smoke Test
 * Starts the server and hits every registered API route.
 * Asserts non-404 (401/403 is fine — means the route exists).
 */
const request = require('supertest');

// Mock DynamoDB before requiring app
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
  // Auth router routes
  const authRoutes = [
    { method: 'get', path: '/api/v1/auth/magic-link' },
    { method: 'get', path: '/api/v1/auth/session' },
    { method: 'get', path: '/api/auth/magic-link' },
    { method: 'get', path: '/api/auth/session' },
  ];

  // Admin router routes
  const adminRoutes = [
    { method: 'get', path: '/api/v1/admin/clients' },
    { method: 'get', path: '/api/admin/clients' },
  ];

  // Dashboard router routes
  const dashboardRoutes = [
    { method: 'get', path: '/api/v1/dashboard/bots' },
    { method: 'get', path: '/api/dashboard/bots' },
  ];

  // Settings router routes
  const settingsRoutes = [
    { method: 'get', path: '/api/v1/settings/profile' },
    { method: 'get', path: '/api/settings/profile' },
  ];

  // Billing router routes
  const billingRoutes = [
    { method: 'get', path: '/api/v1/billing/status' },
    { method: 'get', path: '/api/billing/status' },
  ];

  // Plans (public)
  const plansRoutes = [
    { method: 'get', path: '/api/v1/plans' },
    { method: 'get', path: '/api/plans' },
  ];

  // Individual handler routes
  const individualRoutes = [
    { method: 'post', path: '/api/signup' },
    { method: 'post', path: '/api/v1/signup' },
    { method: 'get', path: '/api/team/members' },
    { method: 'get', path: '/api/v1/team/members' },
    { method: 'post', path: '/api/team/create' },
    { method: 'post', path: '/api/team/invite' },
    { method: 'post', path: '/api/team/remove' },
    { method: 'get', path: '/api/keys/list' },
    { method: 'get', path: '/api/v1/keys/list' },
    { method: 'post', path: '/api/keys/create' },
    { method: 'post', path: '/api/keys/revoke' },
  ];

  // Chat proxy routes
  const chatRoutes = [
    { method: 'post', path: '/api/chat/test-bot/send' },
    { method: 'get', path: '/api/chat/test-bot/events' },
    { method: 'get', path: '/api/chat/test-bot/history' },
    { method: 'post', path: '/api/chat/test-bot/clear' },
  ];

  // Public API v1 routes
  const publicApiRoutes = [
    { method: 'get', path: '/v1/bots' },
    { method: 'post', path: '/v1/bots' },
    { method: 'delete', path: '/v1/bots/test-id' },
    { method: 'get', path: '/v1/usage' },
  ];

  const allRoutes = [
    ...authRoutes, ...adminRoutes, ...dashboardRoutes,
    ...settingsRoutes, ...billingRoutes, ...plansRoutes,
    ...individualRoutes, ...chatRoutes, ...publicApiRoutes,
  ];

  allRoutes.forEach(({ method, path: route }) => {
    test(`${method.toUpperCase()} ${route} → non-404`, async () => {
      const res = await request(app)[method](route).send({});
      expect(res.status).not.toBe(404);
    });
  });
});
