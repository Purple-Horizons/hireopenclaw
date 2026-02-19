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

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { requireAdmin, getEmailFromSession } = require('../auth/middleware.js');
const { validateTenantId, validateBackupId } = require('../util/validate.js');
const { PutItemCommand, QueryCommand, GetItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');

const S3_BUCKET = process.env.BACKUP_S3_BUCKET || 'clawops-backups';
const BACKUP_TABLE = TABLES.BACKUPS || 'clawops-backups';
const EP = process.env.AWS_ENDPOINT_URL || '';
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const USE_LOCAL_ENDPOINT = Boolean(EP);
const SHOULD_AUTO_INIT_BACKUP_STORAGE = USE_LOCAL_ENDPOINT || process.env.BACKUP_AUTO_INIT === 'true';

const ENV = { ...process.env };
if (USE_LOCAL_ENDPOINT) {
  ENV.AWS_ACCESS_KEY_ID = ENV.AWS_ACCESS_KEY_ID || 'test';
  ENV.AWS_SECRET_ACCESS_KEY = ENV.AWS_SECRET_ACCESS_KEY || 'test';
}

function awsCliArgs(args) {
  const out = [...args];
  if (USE_LOCAL_ENDPOINT) out.push('--endpoint-url', EP);
  if (!out.includes('--region')) out.push('--region', AWS_REGION);
  return out;
}

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
    execFileSync('aws', awsCliArgs(['s3', 'mb', `s3://${S3_BUCKET}`]), { encoding: 'utf8', env: ENV, stdio: 'pipe' });
  } catch (err) { /* Bucket may already exist */ }
}

function ensureTable() {
  try {
    execFileSync('aws', awsCliArgs(['dynamodb', 'describe-table', '--table-name', BACKUP_TABLE]), { encoding: 'utf8', env: ENV, stdio: 'pipe' });
  } catch {
    try {
      execFileSync('aws', awsCliArgs([
        'dynamodb', 'create-table', '--table-name', BACKUP_TABLE,
        '--attribute-definitions', 'AttributeName=tenantId,AttributeType=S', 'AttributeName=backupId,AttributeType=S',
        '--key-schema', 'AttributeName=tenantId,KeyType=HASH', 'AttributeName=backupId,KeyType=RANGE',
        '--provisioned-throughput', 'ReadCapacityUnits=5,WriteCapacityUnits=5'
      ]), { encoding: 'utf8', env: ENV, stdio: 'pipe' });
    } catch (err) { console.error('[Backup] Failed to create backup table:', err.message); }
  }
}

// Initialize only for explicit local/dev endpoint or when forced.
if (SHOULD_AUTO_INIT_BACKUP_STORAGE) {
  ensureBucket();
  ensureTable();
}

async function createBackup(tenantId, triggeredBy, reason) {
  if (!validateTenantId(tenantId)) throw new Error('Invalid tenantId format');

  const containerName = `clawops-${tenantId}`;
  const backupId = `bk-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const s3Key = `${tenantId}/${backupId}.tar.gz`;

  try {
    // Check container is running
    execFileSync('docker', ['inspect', containerName, '--format', '{{.State.Status}}'], {
      encoding: 'utf8', env: ENV, stdio: 'pipe'
    });
  } catch {
    throw new Error('Container not found or not running');
  }

  // Create tar inside container — inputs are validated, using execFileSync with array args
  // For the sh -c command, we build the shell string from validated inputs
  const tarPathsStr = BACKUP_PATHS.join(' ');
  execFileSync('docker', [
    'exec', containerName, 'sh', '-c',
    `cd /app && tar czf /tmp/backup.tar.gz ${tarPathsStr} 2>/dev/null || tar czf /tmp/backup.tar.gz --ignore-failed-read ${tarPathsStr} 2>/dev/null || true`
  ], { encoding: 'utf8', timeout: 30000, env: ENV });

  // Copy tar out of container
  const tmpPath = `/tmp/${backupId}.tar.gz`;
  execFileSync('docker', ['cp', `${containerName}:/tmp/backup.tar.gz`, tmpPath], { encoding: 'utf8', env: ENV });

  // Get file size
  const stats = require('fs').statSync(tmpPath);
  const sizeBytes = stats.size;

  // Upload to S3
  execFileSync('aws', awsCliArgs(['s3', 'cp', tmpPath, `s3://${S3_BUCKET}/${s3Key}`]), { encoding: 'utf8', env: ENV });

  // Clean up tmp
  try { require('fs').unlinkSync(tmpPath); } catch (err) { /* cleanup failed */ }

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
  if (!validateTenantId(tenantId)) throw new Error('Invalid tenantId format');

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
  if (!validateTenantId(tenantId)) throw new Error('Invalid tenantId format');
  if (!validateBackupId(backupId)) throw new Error('Invalid backupId format');

  const containerName = `clawops-${tenantId}`;

  // Get backup info
  const backups = await listBackups(tenantId);
  const backup = backups.find(b => b.backupId === backupId);
  if (!backup) throw new Error('Backup not found');

  const s3Key = `${tenantId}/${backupId}.tar.gz`;
  const tmpPath = `/tmp/${backupId}-restore.tar.gz`;

  // Download from S3
  execFileSync('aws', awsCliArgs(['s3', 'cp', `s3://${S3_BUCKET}/${s3Key}`, tmpPath]), { encoding: 'utf8', env: ENV });

  // Copy into container
  execFileSync('docker', ['cp', tmpPath, `${containerName}:/tmp/restore.tar.gz`], { encoding: 'utf8', env: ENV });

  // Extract inside container
  execFileSync('docker', [
    'exec', containerName, 'sh', '-c',
    'cd /app && tar xzf /tmp/restore.tar.gz; rm -f /tmp/restore.tar.gz 2>/dev/null || true'
  ], { encoding: 'utf8', timeout: 30000, env: ENV });

  // Clean up
  try { require('fs').unlinkSync(tmpPath); } catch (err) { /* cleanup failed */ }

  console.log(`[Backup] Restored ${backupId} for ${tenantId} by ${triggeredBy}`);

  return { restored: true, backupId };
}

async function deleteBackup(tenantId, backupId, triggeredBy) {
  if (!validateTenantId(tenantId)) throw new Error('Invalid tenantId format');
  if (!validateBackupId(backupId)) throw new Error('Invalid backupId format');

  const existing = await dynamodb.send(new GetItemCommand({
    TableName: BACKUP_TABLE,
    Key: marshall({ tenantId, backupId })
  }));
  if (!existing.Item) throw new Error('Backup not found');

  const item = unmarshall(existing.Item);
  const s3Key = item.s3Key || `${tenantId}/${backupId}.tar.gz`;

  execFileSync('aws', awsCliArgs(['s3', 'rm', `s3://${S3_BUCKET}/${s3Key}`]), { encoding: 'utf8', env: ENV });

  await dynamodb.send(new DeleteItemCommand({
    TableName: BACKUP_TABLE,
    Key: marshall({ tenantId, backupId })
  }));

  console.log(`[Backup] Deleted ${backupId} for ${tenantId} by ${triggeredBy}`);
  return { deleted: true, backupId };
}

// ─── Admin handlers ───

async function handleAdminBackup(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { tenantId } = req.params;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  // Determine action from URL path first, then query param
  let action = req.query.action;
  if (!action) {
    if (req.path.endsWith('/restore')) action = 'restore';
    else if (req.method === 'DELETE' && req.path.includes('/backups/')) action = 'delete';
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
      if (!validateBackupId(backupId)) return res.status(400).json({ error: 'Invalid backupId format' });
      const result = await restoreBackup(tenantId, backupId, admin);
      return res.json({ ok: true, ...result });
    }

    if (action === 'delete') {
      if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
      const backupId = req.params.backupId || req.body?.backupId || req.query?.backupId;
      if (!backupId) return res.status(400).json({ error: 'backupId required' });
      if (!validateBackupId(backupId)) return res.status(400).json({ error: 'Invalid backupId format' });
      const result = await deleteBackup(tenantId, backupId, admin);
      return res.json({ ok: true, ...result });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[Backup] Error:`, err.message);
    return res.status(500).json({ error: 'Backup operation failed' });
  }
}

// ─── Client handlers ───

async function handleClientBackup(req, res) {
  const email = await getEmailFromSession(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { botId } = req.body || req.query;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  if (!validateTenantId(botId)) return res.status(400).json({ error: 'Invalid botId format' });

  // Verify ownership (inline check)
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
      if (!validateBackupId(backupId)) return res.status(400).json({ error: 'Invalid backupId format' });
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
    return res.status(500).json({ error: 'Backup operation failed' });
  }
}

module.exports = { handleAdminBackup, handleClientBackup, createBackup };
