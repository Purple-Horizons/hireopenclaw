/**
 * Create Bot API - LocalStack Version  
 * POST /api/dashboard/create-bot
 * Provisions a new bot via MasterControl
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);


const { requireAuth } = require('../auth/middleware.js');
const { canCreateBot, getUserPlan, ensureTeam } = require('../auth/team-plan.js');
const { validateTenantId, validateBotName, validateEmail, validatePlan, validateTemplate } = require('../util/validate.js');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check — infer email from session
  const sessionEmail = await requireAuth(req, res);
  if (!sessionEmail) return;

  const { 
    email: bodyEmail,
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
    
    // If tenantId provided, update existing record; otherwise create new
    let finalTenantId = tenantId;
    
    if (!finalTenantId) {
      // Generate new tenant ID
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 6);
      finalTenantId = `tenant-${timestamp}-${random}`;
    }

    // Validate the tenantId (whether provided or generated)
    if (!validateTenantId(finalTenantId)) {
      return res.status(400).json({ error: 'Invalid tenantId format' });
    }

    // Update tenant record with bot details
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { tenantId: finalTenantId },
      UpdateExpression: 'SET #name = :name, #role = :role, #template = :template, #status = :status, email = :email, createdAt = if_not_exists(createdAt, :now), updatedAt = :now',
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
        ':now': Math.floor(Date.now() / 1000)  // Unix timestamp in seconds
      }
    }));

    console.log(`[Create Bot] Updated tenant record: ${finalTenantId}`);

    // Call MasterControl to provision bot locally
    const clawopsPath = '/Users/giannidalerta/.openclaw/workspace/repos/clawops';

    console.log(`[Create Bot] Provisioning ${finalTenantId}...`);

    try {
      const { stdout, stderr } = await execFileAsync(
        '/opt/homebrew/bin/clawops',
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
          timeout: 120000,
          env: {
            ...process.env,
            AWS_ENDPOINT_URL: 'http://localhost:4566',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
            AWS_DEFAULT_REGION: 'us-east-1',
            DYNAMODB_TABLE: 'clawops-tenants',
            S3_BUCKET: 'clawops-artifacts'
          }
        }
      );

      console.log('[Create Bot] Provision output:', stdout);
      if (stderr) console.error('[Create Bot] Provision errors:', stderr);

      // Parse endpoint from provision output (format: "  ✓ Endpoint registered: http://localhost:XXXXX")
      const endpointMatch = stdout.match(/Endpoint registered:\s+(http:\/\/localhost:\d+)/);
      const endpoint = endpointMatch ? endpointMatch[1] : `http://localhost:18791`;

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
          ':now': Math.floor(Date.now() / 1000)
        }
      }));

      // Return bot details
      return res.status(200).json({
        ok: true,
        tenantId: finalTenantId,
        botName,
        status: 'active',
        message: 'Bot provisioned successfully',
        endpoint
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
