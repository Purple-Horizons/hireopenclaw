const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const isLocal = process.env.NODE_ENV !== 'production';

const client = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  ...(isLocal && {
    endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    }
  })
});

const docClient = DynamoDBDocumentClient.from(client);

// Table names
const TABLES = {
  TENANTS: process.env.DYNAMODB_TABLE || 'clawops-tenants',
  SECRETS: 'clawops-secrets',
  BACKUPS: 'clawops-backups',
  USAGE: 'clawops-usage',
  API_KEYS: 'clawops-api-keys',
  TEAMS: 'clawops-teams',
  TEAM_MEMBERS: 'clawops-team-members',
  USER_PREFERENCES: 'clawops-user-preferences',
};

module.exports = { client, docClient, TABLES };
