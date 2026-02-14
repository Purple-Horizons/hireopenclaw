/**
 * Create Bot API - LocalStack Version  
 * POST /api/dashboard/create-bot
 * Provisions a new bot via MasterControl
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configure DynamoDB client for LocalStack
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    email,
    tenantId,  // From onboarding signup
    botName, 
    botRole, 
    template, 
    plan 
  } = req.body || {};

  if (!email || !botName) {
    return res.status(400).json({ error: 'Email and botName are required' });
  }

  console.log(`[Create Bot] Request from ${email}: "${botName}" (${template || 'blank'})`);

  try {
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';
    
    // If tenantId provided, update existing record; otherwise create new
    let finalTenantId = tenantId;
    
    if (!finalTenantId) {
      // Generate new tenant ID
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 6);
      finalTenantId = `tenant-${timestamp}-${random}`;
    }

    // Update tenant record with bot details
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { tenantId: finalTenantId },
      UpdateExpression: 'SET #name = :name, #role = :role, #template = :template, #status = :status, #plan = :plan, email = :email, createdAt = if_not_exists(createdAt, :now), updatedAt = :now',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#role': 'role',
        '#template': 'template',
        '#status': 'status',
        '#plan': 'plan'
      },
      ExpressionAttributeValues: {
        ':name': botName,
        ':role': botRole || 'Assistant',
        ':template': template || 'blank',
        ':status': 'provisioning',
        ':plan': plan || 'starter',
        ':email': email,
        ':now': Math.floor(Date.now() / 1000)  // Unix timestamp in seconds
      }
    }));

    console.log(`[Create Bot] Updated tenant record: ${finalTenantId}`);

    // Call MasterControl to provision bot locally
    // This runs the clawops CLI to provision a local Docker container
    const clawopsPath = '/Users/giannidalerta/.openclaw/workspace/repos/clawops';
    const cmd = `cd ${clawopsPath} && bin/clawops provision --tenant-id ${finalTenantId} --email ${email} --name "${botName}" --plan ${plan || 'starter'} --template ${template || 'blank'} --mode managed`;

    console.log(`[Create Bot] Running: ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000,  // 30 second timeout
        env: {
          ...process.env,
          AWS_ENDPOINT_URL: 'http://localhost:4566',
          AWS_ACCESS_KEY_ID: 'test',
          AWS_SECRET_ACCESS_KEY: 'test',
          AWS_DEFAULT_REGION: 'us-east-1',
          DYNAMODB_TABLE: 'clawops-tenants',
          S3_BUCKET: 'clawops-artifacts'
        }
      });

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
          ':now': Math.floor(Date.now() / 1000)  // Unix timestamp in seconds
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
      console.error('[Create Bot] Provision failed:', provisionError);

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
        error: 'Provisioning failed',
        details: provisionError.message
      });
    }

  } catch (error) {
    console.error('[Create Bot] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to create bot',
      details: error.message 
    });
  }
};
