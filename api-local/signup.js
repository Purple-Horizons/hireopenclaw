/**
 * Signup API - LocalStack Version
 * Creates initial tenant record in DynamoDB
 */

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('./util/dynamodb.js');
const { ERROR_CODES, apiError } = require('./util/error-codes.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json(apiError(ERROR_CODES.METHOD_NOT_ALLOWED));
  }

  const { name, email, phone, company } = req.body || {};

  if (!name || !email) {
    return res.status(400).json(apiError(ERROR_CODES.MISSING_FIELD, 'Name and email are required'));
  }

  console.log(`[Signup] New lead: ${name} | ${email} | ${phone || 'no phone'}`);

  const safeName = escapeHtml(String(name));
  const safeEmail = escapeHtml(String(email));
  const safePhone = escapeHtml(String(phone || 'N/A'));
  const safeCompany = escapeHtml(String(company || 'N/A'));

  try {
    // Generate tenant ID (simplified version)
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 6);
    const tenantId = `tenant-${timestamp}-${random}`;

    // Create tenant record in DynamoDB
    const tableName = TABLES.TENANTS;
    
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        tenantId,
        email,
        name,
        contactName: name,
        phone: phone || '',
        contactPhone: phone || '',
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
            subject: `🔥 New Signup: ${safeName}`,
            html: `<h2>New Signup</h2>
              <p><strong>Name:</strong> ${safeName}</p>
              <p><strong>Email:</strong> ${safeEmail}</p>
              <p><strong>Phone:</strong> ${safePhone}</p>
              <p><strong>Company:</strong> ${safeCompany}</p>
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
    return res.status(500).json(apiError(ERROR_CODES.INTERNAL));
  }
};

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
