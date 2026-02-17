/**
 * Secrets Management — Platform-level & Per-client
 * 
 * Scope format:
 *   "platform"              → admin-only platform secrets (fal-ai, OpenRouter, etc.)
 *   "client:test@test.com"  → per-client secrets (their ElevenLabs, Metricool, etc.)
 * 
 * Values are encrypted with AES-256-GCM before storage.
 * Secret values are NEVER returned in API responses — only masked previews.
 * 
 * Routes:
 *   GET    /api/admin/secrets?scope=platform         → list platform secrets (admin)
 *   POST   /api/admin/secrets                        → set a secret (admin)
 *   DELETE /api/admin/secrets                        → delete a secret (admin)
 *   GET    /api/settings/secrets                     → list own secrets (client)
 *   POST   /api/settings/secrets                     → set own secret (client)
 *   DELETE /api/settings/secrets                     → delete own secret (client)
 */

const crypto = require('crypto');
const { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { requireAdmin, getEmailFromSession } = require('../auth/middleware.js');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

const TABLE = 'clawops-secrets';

// Encryption key — in production, MUST be set via env var
const ENV_KEY = process.env.SECRETS_ENCRYPTION_KEY;
if (!ENV_KEY && process.env.NODE_ENV === 'production') {
  console.error('FATAL: SECRETS_ENCRYPTION_KEY must be set in production');
  process.exit(1);
}
if (!ENV_KEY) {
  console.warn('[Secrets] WARNING: Using default encryption key — set SECRETS_ENCRYPTION_KEY for production');
}
const ENCRYPTION_KEY = crypto.scryptSync(
  ENV_KEY || 'clawops-local-dev-key-change-in-production',
  'clawops-secrets-salt',
  32
);

function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function maskValue(value) {
  if (!value || value.length < 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

// ─── List secrets for a scope ───
async function listSecrets(scope) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#s = :scope',
    ExpressionAttributeNames: { '#s': 'scope' },
    ExpressionAttributeValues: { ':scope': { S: scope } }
  }));

  return (result.Items || []).map(item => {
    const i = unmarshall(item);
    let preview;
    try {
      preview = maskValue(decrypt(i.encryptedValue));
    } catch {
      preview = '••••••••';
    }
    return {
      key: i.key,
      label: i.label || i.key,
      preview,
      updatedAt: i.updatedAt,
      updatedBy: i.updatedBy
    };
  });
}

// ─── Set a secret ───
async function setSecret(scope, key, value, label, updatedBy) {
  await dynamodb.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall({
      scope,
      key,
      label: label || key,
      encryptedValue: encrypt(value),
      updatedAt: new Date().toISOString(),
      updatedBy
    })
  }));
}

// ─── Delete a secret ───
async function deleteSecret(scope, key) {
  await dynamodb.send(new DeleteItemCommand({
    TableName: TABLE,
    Key: marshall({ scope, key })
  }));
}

// ─── Get decrypted value (internal use only — for injecting into bot config) ───
async function getSecretValue(scope, key) {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: TABLE,
    Key: marshall({ scope, key })
  }));
  if (!result.Item) return null;
  const item = unmarshall(result.Item);
  return decrypt(item.encryptedValue);
}

// ─── Admin handler: platform secrets ───
async function handleAdminSecrets(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const scope = req.query.scope || req.body?.scope || 'platform';

  if (req.method === 'GET') {
    const secrets = await listSecrets(scope);
    return res.json({ ok: true, scope, secrets });
  }

  if (req.method === 'POST') {
    const { key, value, label } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });

    await setSecret(scope, key, value, label, admin);
    console.log(`[Secrets] ${admin} set ${scope}/${key}`);
    return res.json({ ok: true, message: `Secret ${key} saved` });
  }

  if (req.method === 'DELETE') {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });

    await deleteSecret(scope, key);
    console.log(`[Secrets] ${admin} deleted ${scope}/${key}`);
    return res.json({ ok: true, message: `Secret ${key} deleted` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Client handler: own secrets ───
async function handleClientSecrets(req, res) {
  const email = getEmailFromSession(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const scope = `client:${email}`;

  if (req.method === 'GET') {
    const secrets = await listSecrets(scope);
    return res.json({ ok: true, scope, secrets });
  }

  if (req.method === 'POST') {
    const { key, value, label } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });

    await setSecret(scope, key, value, label, email);
    return res.json({ ok: true, message: `Secret ${key} saved` });
  }

  if (req.method === 'DELETE') {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });

    await deleteSecret(scope, key);
    return res.json({ ok: true, message: `Secret ${key} deleted` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = { handleAdminSecrets, handleClientSecrets, getSecretValue };
