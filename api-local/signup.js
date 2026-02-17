/**
 * Signup API - LocalStack Version
 * Creates initial tenant record in DynamoDB
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

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

  const { name, email, phone, company } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  console.log(`[Signup] New lead: ${name} | ${email} | ${phone || 'no phone'}`);

  try {
    // Generate tenant ID (simplified version)
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 6);
    const tenantId = `tenant-${timestamp}-${random}`;

    // Create tenant record in DynamoDB
    const tableName = process.env.DYNAMODB_TABLE || 'clawops-tenants';
    
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        tenantId,
        email,
        name,
        phone: phone || '',
        company: company || '',
        status: 'pending_onboarding',  // Not yet provisioned
        plan: 'starter',  // Default plan
        createdAt: new Date().toISOString(),
        createdBy: 'signup-form',
        healthStatus: 'pending',
        consecutiveFailures: 0
      }
    }));

    console.log(`[Signup] Created tenant record: ${tenantId}`);

    // Try to send notification email (non-blocking)
    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: 'onboarding@resend.dev',
            to: 'g@purplehorizons.io',
            subject: `🔥 New Signup: ${name}`,
            html: `<h2>New Signup</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
              <p><strong>Company:</strong> ${company || 'N/A'}</p>
              <p><strong>Tenant ID:</strong> ${tenantId}</p>
              <p><strong>Time:</strong> ${new Date().toISOString()}</p>`
          })
        });
      } catch (err) {
        console.error('[Signup] Email notification failed:', err.message);
      }
    }

    return res.status(200).json({ 
      ok: true,
      tenantId,
      message: 'Signup successful. Proceed to onboarding.'
    });

  } catch (error) {
    console.error('[Signup] Database error:', error);
    return res.status(500).json({ 
      error: 'Failed to create account'
    });
  }
};
