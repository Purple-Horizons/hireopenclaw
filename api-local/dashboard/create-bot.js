/**
 * Create Bot API
 * POST /api/dashboard/create-bot
 * Provisions a new bot via MasterControl
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const CLAWOPS_BIN = process.env.CLAWOPS_BIN || 'clawops';
const CLAWOPS_PROVISION_TIMEOUT_MS = Number(process.env.CLAWOPS_PROVISION_TIMEOUT_MS || 120000);

const { requireAuth } = require('../auth/middleware.js');
const { canCreateBot, getUserPlan } = require('../auth/team-plan.js');
const { validateTenantId, validateBotName, validateEmail, validatePlan, validateTemplate } = require('../util/validate.js');
const { UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check — infer email from session
  const sessionEmail = await requireAuth(req, res);
  if (!sessionEmail) return;

  const { 
    tenantId,  // From onboarding signup
    botName, 
    botRole, 
    template, 
    plan 
  } = req.body || {};

  // Use session email (trusted), fall back to body email for backwards compat
  const email = sessionEmail;

  if (!botName) {
    return res.status(400).json({ error: 'botName is required' });
  }

  // Validate all inputs
  if (!validateBotName(botName)) {
    return res.status(400).json({ error: 'Invalid bot name format' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!validatePlan(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  if (!validateTemplate(template)) {
    return res.status(400).json({ error: 'Invalid template' });
  }

  console.log(`[Create Bot] Request from ${email}: "${botName}" (${template || 'blank'})`);

  try {
    // TASK-300: Check team plan for bot slot availability
    const botCheck = await canCreateBot(email);
    if (!botCheck.allowed) {
      return res.status(403).json({ error: botCheck.reason, code: 'BOT_LIMIT_REACHED' });
    }
    const userPlan = await getUserPlan(email);
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';
    
    let finalTenantId = tenantId;
    const nowIso = new Date().toISOString();

    if (!finalTenantId) {
      // Generate new tenant ID for direct create flow
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 6);
      finalTenantId = `tenant-${timestamp}-${random}`;
    }

    // Validate the tenantId (whether provided or generated)
    if (!validateTenantId(finalTenantId)) {
      return res.status(400).json({ error: 'Invalid tenantId format' });
    }

    if (tenantId) {
      const existing = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { tenantId: finalTenantId }
      }));
      if (!existing.Item) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      if (existing.Item.email && existing.Item.email !== email) {
        return res.status(403).json({ error: 'Access denied for tenantId' });
      }

      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: finalTenantId },
        UpdateExpression: 'SET #name = :name, #role = :role, #template = :template, #status = :status, email = if_not_exists(email, :email), updatedAt = :now',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#role': 'role',
          '#template': 'template',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':name': botName,
          ':role': botRole || 'Assistant',
          ':template': template || 'blank',
          ':status': 'provisioning',
          ':email': email,
          ':now': nowIso
        }
      }));
    } else {
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: finalTenantId },
        UpdateExpression: 'SET email = :email, #name = :name, #role = :role, #template = :template, #status = :status, #plan = :plan, createdAt = :createdAt, updatedAt = :updatedAt, healthStatus = :health, createdBy = :createdBy',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#role': 'role',
          '#template': 'template',
          '#status': 'status',
          '#plan': 'plan'
        },
        ExpressionAttributeValues: {
          ':email': email,
          ':name': botName,
          ':role': botRole || 'Assistant',
          ':template': template || 'blank',
          ':status': 'provisioning',
          ':plan': userPlan,
          ':createdAt': nowIso,
          ':updatedAt': nowIso,
          ':health': 'pending',
          ':createdBy': 'dashboard-create-bot'
        },
        ConditionExpression: 'attribute_not_exists(tenantId)'
      }));
    }

    console.log(`[Create Bot] Updated tenant record: ${finalTenantId}`);

    console.log(`[Create Bot] Provisioning ${finalTenantId}...`);

    try {
      const provisionEnv = {
        ...process.env,
        DYNAMODB_TABLE: process.env.DYNAMODB_TABLE || TABLES.TENANTS || 'clawops-tenants',
        S3_BUCKET: process.env.S3_BUCKET || 'clawops-artifacts'
      };

      // When explicitly targeting a local AWS endpoint, supply local credentials defaults.
      if (provisionEnv.AWS_ENDPOINT_URL) {
        provisionEnv.AWS_ACCESS_KEY_ID = provisionEnv.AWS_ACCESS_KEY_ID || 'test';
        provisionEnv.AWS_SECRET_ACCESS_KEY = provisionEnv.AWS_SECRET_ACCESS_KEY || 'test';
        provisionEnv.AWS_DEFAULT_REGION = provisionEnv.AWS_DEFAULT_REGION || 'us-east-1';
      }

      const { stdout, stderr } = await execFileAsync(
        CLAWOPS_BIN,
        [
          'provision',
          '--tenant-id', finalTenantId,
          '--email', email,
          '--name', botName,
          '--plan', userPlan,
          '--template', template || 'blank',
          '--mode', 'managed'
        ],
        {
          timeout: CLAWOPS_PROVISION_TIMEOUT_MS,
          env: provisionEnv
        }
      );

      console.log('[Create Bot] Provision output:', stdout);
      if (stderr) console.error('[Create Bot] Provision errors:', stderr);

      // Parse endpoint from provision output if present.
      const endpointMatch = stdout.match(/Endpoint registered:\s+(\S+)/);
      const endpoint = endpointMatch ? endpointMatch[1] : null;

      // Update status to active
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: finalTenantId },
        UpdateExpression: 'SET #status = :status, healthStatus = :health, provisionedAt = :now, lastActive = :now',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'active',
          ':health': 'healthy',
          ':now': new Date().toISOString()
        }
      }));

      // Return bot details
      return res.status(200).json({
        ok: true,
        tenantId: finalTenantId,
        botName,
        status: 'active',
        message: 'Bot provisioned successfully',
        endpoint: endpoint || undefined
      });

    } catch (provisionError) {
      console.error('[Create Bot] Provision failed:', provisionError.message);

      // Update status to error
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: finalTenantId },
        UpdateExpression: 'SET #status = :status, healthStatus = :health, errorMessage = :error',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'error',
          ':health': 'unhealthy',
          ':error': provisionError.message
        }
      }));

      return res.status(500).json({
        error: 'Provisioning failed'
      });
    }

  } catch (error) {
    console.error('[Create Bot] Error:', error.message);
    return res.status(500).json({ 
      error: 'Failed to create bot'
    });
  }
};
