/**
 * Bot Instance Backup & Recovery
 * 
 * Backs up the bot's workspace directory to S3 (LocalStack in dev).
 * Includes: SOUL.md, memory/, skills config, openclaw.json, auth-profiles.json
 * 
 * Routes:
 *   POST /api/admin/bots/:tenantId/backup   — Create backup
 *   GET  /api/admin/bots/:tenantId/backups   — List backups
 *   POST /api/admin/bots/:tenantId/restore   — Restore from backup
 *   
 *   POST /api/settings/backup                — User triggers own bot backup
 *   GET  /api/settings/backups               — User lists own backups
 *   POST /api/settings/restore               — User restores own bot
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const { requireAdmin, getEmailFromSession } = require('../auth/middleware.js');
const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

const S3_BUCKET = 'clawops-backups';
const BACKUP_TABLE = 'clawops-backups';
const EP = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';

const ENV = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'test',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'test'
};

// Files/dirs to backup from bot workspace
const BACKUP_PATHS = [
  '.openclaw/openclaw.json',
  '.openclaw/agents/main/agent/SOUL.md',
  '.openclaw/agents/main/agent/USER.md',
  '.openclaw/agents/main/agent/AGENTS.md',
  '.openclaw/agents/main/agent/TOOLS.md',
  '.openclaw/agents/main/agent/MEMORY.md',
  '.openclaw/agents/main/agent/HEARTBEAT.md',
  '.openclaw/agents/main/agent/models.json',
  '.openclaw/agents/main/agent/auth-profiles.json',
  '.openclaw/workspace/',
];

function ensureBucket() {
  try {
    execSync(`aws s3 mb s3://${S3_BUCKET} --endpoint-url ${EP} 2>/dev/null`, { encoding: 'utf8', env: ENV });
  } catch {} // Already exists
}

function ensureTable() {
  try {
    execSync(`aws dynamodb describe-table --table-name ${BACKUP_TABLE} --endpoint-url ${EP} --region us-east-1 2>/dev/null`, { encoding: 'utf8', env: ENV });
  } catch {
    try {
      execSync(`aws dynamodb create-table --table-name ${BACKUP_TABLE} \
        --attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=backupId,AttributeType=S \
        --key-schema AttributeName=tenantId,KeyType=HASH AttributeName=backupId,KeyType=RANGE \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --endpoint-url ${EP} --region us-east-1 2>/dev/null`, { encoding: 'utf8', env: ENV });
    } catch {}
  }
}

// Initialize
ensureBucket();
ensureTable();

async function createBackup(tenantId, triggeredBy, reason) {
  const containerName = `clawops-${tenantId}`;
  const backupId = `bk-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const s3Key = `${tenantId}/${backupId}.tar.gz`;

  // Create tarball inside the container
  const tarPaths = BACKUP_PATHS.map(p => `/app/${p}`).join(' ');
  try {
    // Check container is running
    execSync(`docker inspect ${containerName} --format '{{.State.Status}}' 2>/dev/null`, { encoding: 'utf8', env: ENV }).trim();
  } catch {
    throw new Error(`Container ${containerName} not found or not running`);
  }

  // Create tar inside container (ignore missing files)
  const tarCmd = `docker exec ${containerName} sh -c "cd /app && tar czf /tmp/backup.tar.gz ${BACKUP_PATHS.join(' ')} 2>/dev/null || tar czf /tmp/backup.tar.gz --ignore-failed-read ${BACKUP_PATHS.join(' ')} 2>/dev/null || true"`;
  execSync(tarCmd, { encoding: 'utf8', timeout: 30000, env: ENV });

  // Copy tar out of container
  const tmpPath = `/tmp/${backupId}.tar.gz`;
  execSync(`docker cp ${containerName}:/tmp/backup.tar.gz ${tmpPath}`, { encoding: 'utf8', env: ENV });

  // Get file size
  const stats = require('fs').statSync(tmpPath);
  const sizeBytes = stats.size;

  // Upload to S3
  execSync(`aws s3 cp ${tmpPath} s3://${S3_BUCKET}/${s3Key} --endpoint-url ${EP} --region us-east-1`, { encoding: 'utf8', env: ENV });

  // Clean up tmp
  try { require('fs').unlinkSync(tmpPath); } catch {}

  // Record in DynamoDB
  await dynamodb.send(new PutItemCommand({
    TableName: BACKUP_TABLE,
    Item: marshall({
      tenantId,
      backupId,
      s3Key,
      sizeBytes,
      reason: reason || 'manual',
      triggeredBy,
      createdAt: new Date().toISOString(),
      status: 'complete'
    })
  }));

  console.log(`[Backup] Created ${backupId} for ${tenantId} (${(sizeBytes / 1024).toFixed(1)} KB) by ${triggeredBy}`);

  return { backupId, s3Key, sizeBytes, createdAt: new Date().toISOString() };
}

async function listBackups(tenantId) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: BACKUP_TABLE,
    KeyConditionExpression: 'tenantId = :tid',
    ExpressionAttributeValues: { ':tid': { S: tenantId } },
    ScanIndexForward: false // newest first
  }));

  return (result.Items || []).map(item => {
    const i = unmarshall(item);
    return {
      backupId: i.backupId,
      sizeKB: (i.sizeBytes / 1024).toFixed(1),
      reason: i.reason,
      triggeredBy: i.triggeredBy,
      createdAt: i.createdAt,
      status: i.status
    };
  });
}

async function restoreBackup(tenantId, backupId, triggeredBy) {
  const containerName = `clawops-${tenantId}`;

  // Get backup info
  const backups = await listBackups(tenantId);
  const backup = backups.find(b => b.backupId === backupId);
  if (!backup) throw new Error('Backup not found');

  const s3Key = `${tenantId}/${backupId}.tar.gz`;
  const tmpPath = `/tmp/${backupId}-restore.tar.gz`;

  // Download from S3
  execSync(`aws s3 cp s3://${S3_BUCKET}/${s3Key} ${tmpPath} --endpoint-url ${EP} --region us-east-1`, { encoding: 'utf8', env: ENV });

  // Copy into container
  execSync(`docker cp ${tmpPath} ${containerName}:/tmp/restore.tar.gz`, { encoding: 'utf8', env: ENV });

  // Extract inside container
  execSync(`docker exec ${containerName} sh -c "cd /app && tar xzf /tmp/restore.tar.gz; rm -f /tmp/restore.tar.gz 2>/dev/null || true"`, { encoding: 'utf8', timeout: 30000, env: ENV });

  // Clean up
  try { require('fs').unlinkSync(tmpPath); } catch {}

  console.log(`[Backup] Restored ${backupId} for ${tenantId} by ${triggeredBy}`);

  return { restored: true, backupId };
}

// ─── Admin handlers ───

async function handleAdminBackup(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { tenantId } = req.params;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

  // Determine action from URL path first, then query param
  let action = req.query.action;
  if (!action) {
    if (req.path.endsWith('/restore')) action = 'restore';
    else if (req.path.endsWith('/backups')) action = 'list';
    else if (req.path.endsWith('/backup')) action = 'create';
    else action = req.method === 'POST' ? 'create' : 'list';
  }

  try {
    if (action === 'create') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      const result = await createBackup(tenantId, admin, req.body?.reason || 'admin-manual');
      return res.json({ ok: true, ...result });
    }

    if (action === 'list') {
      const backups = await listBackups(tenantId);
      return res.json({ ok: true, backups });
    }

    if (action === 'restore') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      const { backupId } = req.body;
      if (!backupId) return res.status(400).json({ error: 'backupId required' });
      const result = await restoreBackup(tenantId, backupId, admin);
      return res.json({ ok: true, ...result });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[Backup] Error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Client handlers ───

async function handleClientBackup(req, res) {
  const email = getEmailFromSession(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { botId } = req.body || req.query;
  if (!botId) return res.status(400).json({ error: 'botId required' });

  // Verify ownership (inline check)
  const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
  const result = await dynamodb.send(new GetItemCommand({
    TableName: 'clawops-tenants',
    Key: { tenantId: { S: botId } }
  }));
  if (!result.Item) return res.status(403).json({ error: 'Bot not found' });
  const bot = unmarshall(result.Item);
  if (bot.email !== email) return res.status(403).json({ error: 'Access denied' });

  try {
    if (req.path.includes('restore')) {
      const { backupId } = req.body;
      if (!backupId) return res.status(400).json({ error: 'backupId required' });
      const r = await restoreBackup(botId, backupId, email);
      return res.json({ ok: true, ...r });
    }

    if (req.method === 'POST') {
      const r = await createBackup(botId, email, 'user-manual');
      return res.json({ ok: true, ...r });
    }

    // GET = list
    const backups = await listBackups(botId);
    return res.json({ ok: true, backups });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { handleAdminBackup, handleClientBackup, createBackup };
