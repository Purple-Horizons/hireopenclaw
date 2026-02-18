/**
 * API Key Management
 * POST /api/settings/api-keys - Generate new API key
 * GET /api/settings/api-keys - List user's API keys
 * DELETE /api/settings/api-keys/:keyId - Revoke API key
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

function generateApiKey() {
    return 'clw_' + crypto.randomBytes(32).toString('hex');
}

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

module.exports = async (req, res) => {
    const email = req.query.email || (req.body && req.body.email);
    
    if (!email) {
        return res.status(400).json({ error: 'email is required' });
    }
    
    // Generate new API key
    if (req.method === 'POST') {
        const { name, scopes } = req.body || {};
        
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }
        
        const apiKey = generateApiKey();
        const keyHash = hashKey(apiKey);
        const keyId = crypto.randomBytes(16).toString('hex');
        
        try {
            // Store in DynamoDB
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb put-item \
                --table-name clawops-api-keys \
                --item '{
                    "keyId": {"S": "${keyId}"},
                    "email": {"S": "${email}"},
                    "keyHash": {"S": "${keyHash}"},
                    "name": {"S": "${name}"},
                    "scopes": {"SS": ${JSON.stringify(scopes || ['read'])}},
                    "createdAt": {"S": "${new Date().toISOString()}"},
                    "lastUsed": {"NULL": true},
                    "active": {"BOOL": true}
                }'`;
            
            execSync(cmd, { 
                encoding: 'utf8',
                env: { 
                    ...process.env,
                    AWS_ACCESS_KEY_ID: 'test',
                    AWS_DEFAULT_REGION: 'us-east-1',
                    AWS_SECRET_ACCESS_KEY: 'test'
                }
            });
            
            // Return the key ONCE (never shown again)
            return res.status(201).json({
                ok: true,
                keyId,
                apiKey, // Only shown once!
                name,
                scopes: scopes || ['read'],
                message: 'Save this key now - it won\'t be shown again!'
            });
            
        } catch (err) {
            console.error('Failed to create API key:', err);
            return res.status(500).json({ error: 'Failed to create API key' });
        }
    }
    
    // List API keys
    if (req.method === 'GET') {
        try {
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb query \
                --table-name clawops-api-keys \
                --index-name email-index \
                --key-condition-expression "email = :email" \
                --expression-attribute-values '{":email":{"S":"${email}"}}' \
                --output json`;
            
            const result = execSync(cmd, {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    AWS_ACCESS_KEY_ID: 'test',
                    AWS_DEFAULT_REGION: 'us-east-1',
                    AWS_SECRET_ACCESS_KEY: 'test'
                }
            });
            
            const data = JSON.parse(result);
            
            const keys = (data.Items || [])
                .map(item => ({
                    keyId: item.keyId?.S,
                    name: item.name?.S,
                    scopes: item.scopes?.SS || [],
                    createdAt: item.createdAt?.S,
                    lastUsed: item.lastUsed?.S || null,
                    active: item.active?.BOOL !== false,
                    // Never return the actual key
                    preview: 'clw_' + '•'.repeat(12) + (item.keyId?.S?.slice(-4) || '••••')
                }))
                .filter(k => k.active); // Hide revoked keys
            
            return res.status(200).json({
                ok: true,
                keys
            });
            
        } catch (err) {
            console.error('Failed to list API keys:', err);
            return res.status(500).json({ error: 'Failed to list API keys' });
        }
    }
    
    // Revoke API key
    if (req.method === 'DELETE') {
        const { keyId } = req.body || {};
        
        if (!keyId) {
            return res.status(400).json({ error: 'keyId is required' });
        }
        
        try {
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb update-item \
                --table-name clawops-api-keys \
                --key '{"keyId":{"S":"${keyId}"}}' \
                --update-expression "SET active = :false" \
                --expression-attribute-values '{":false":{"BOOL":false}}' \
                --return-values ALL_NEW`;
            
            execSync(cmd, {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    AWS_ACCESS_KEY_ID: 'test',
                    AWS_DEFAULT_REGION: 'us-east-1',
                    AWS_SECRET_ACCESS_KEY: 'test'
                }
            });
            
            return res.status(200).json({
                ok: true,
                message: 'API key revoked'
            });
            
        } catch (err) {
            console.error('Failed to revoke API key:', err);
            return res.status(500).json({ error: 'Failed to revoke API key' });
        }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};
