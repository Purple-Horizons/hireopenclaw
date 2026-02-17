#!/usr/bin/env node
/**
 * Initialize DynamoDB tables with required GSIs for LocalStack dev.
 * Run: node scripts/init-tables.js
 *
 * Tables & indexes created:
 *   clawops-tenants       — PK: tenantId, GSI: email-index (email)
 *   clawops-api-keys      — PK: keyId, GSI: userId-index, email-index, apiKeyHash-index (keyHash)
 *   clawops-usage         — PK: tenantId, SK: date
 *   clawops-secrets       — PK: scope, SK: key
 *   clawops-backups       — PK: tenantId, SK: backupId
 *   clawops-teams         — PK: teamId
 *   clawops-team-members  — PK: teamId, SK: userId
 *   clawops-user-preferences — PK: userId
 */

const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, UpdateTableCommand } = require('@aws-sdk/client-dynamodb');

const EP = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';

const client = new DynamoDBClient({
  region: REGION,
  endpoint: EP,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});

const PT = { ReadCapacityUnits: 5, WriteCapacityUnits: 5 };

const TABLES = [
  {
    TableName: 'clawops-tenants',
    KeySchema: [{ AttributeName: 'tenantId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'tenantId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: PT,
      },
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: PT,
      },
    ],
    ProvisionedThroughput: PT,
  },
  {
    TableName: 'clawops-api-keys',
    KeySchema: [{ AttributeName: 'keyId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'keyId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'keyHash', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: PT,
      },
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: PT,
      },
      {
        IndexName: 'apiKeyHash-index',
        KeySchema: [{ AttributeName: 'keyHash', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: PT,
      },
    ],
    ProvisionedThroughput: PT,
  },
  {
    TableName: 'clawops-usage',
    KeySchema: [
      { AttributeName: 'tenantId', KeyType: 'HASH' },
      { AttributeName: 'date', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'tenantId', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' },
    ],
    ProvisionedThroughput: PT,
  },
  {
    TableName: 'clawops-secrets',
    KeySchema: [
      { AttributeName: 'scope', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'scope', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' },
    ],
    ProvisionedThroughput: PT,
  },
  {
    TableName: 'clawops-backups',
    KeySchema: [
      { AttributeName: 'tenantId', KeyType: 'HASH' },
      { AttributeName: 'backupId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'tenantId', AttributeType: 'S' },
      { AttributeName: 'backupId', AttributeType: 'S' },
    ],
    ProvisionedThroughput: PT,
  },
];

async function createOrSkip(def) {
  try {
    await client.send(new DescribeTableCommand({ TableName: def.TableName }));
    console.log(`  ✓ ${def.TableName} (exists)`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      await client.send(new CreateTableCommand(def));
      console.log(`  ✓ ${def.TableName} (created)`);
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log(`Initializing DynamoDB tables at ${EP}...\n`);
  for (const t of TABLES) {
    await createOrSkip(t);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Init failed:', err);
  process.exit(1);
});
