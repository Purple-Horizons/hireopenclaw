/**
 * Team Management
 * POST /api/settings/team - Invite team member
 * GET /api/settings/team - List team members
 * DELETE /api/settings/team/:memberId - Remove team member
 * PATCH /api/settings/team/:memberId - Update member role
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

const ROLES = ['owner', 'admin', 'member', 'viewer'];

function generateInviteToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = async (req, res) => {
    const email = req.query.email || (req.body && req.body.email);
    
    if (!email) {
        return res.status(400).json({ error: 'email is required' });
    }
    
    // Invite team member
    if (req.method === 'POST') {
        const { inviteEmail, role, message } = req.body || {};
        
        if (!inviteEmail) {
            return res.status(400).json({ error: 'inviteEmail is required' });
        }
        
        if (!ROLES.includes(role)) {
            return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
        }
        
        const inviteToken = generateInviteToken();
        const inviteId = crypto.randomBytes(16).toString('hex');
        
        try {
            // Store invite in DynamoDB
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb put-item \
                --table-name clawops-team-invites \
                --item '{
                    "inviteId": {"S": "${inviteId}"},
                    "orgEmail": {"S": "${email}"},
                    "inviteEmail": {"S": "${inviteEmail}"},
                    "role": {"S": "${role}"},
                    "inviteToken": {"S": "${inviteToken}"},
                    "message": {"S": "${message || ''}"},
                    "createdAt": {"S": "${new Date().toISOString()}"},
                    "expiresAt": {"S": "${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()}"},
                    "accepted": {"BOOL": false}
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
            
            // TODO: Send invitation email
            const inviteLink = `http://localhost:3000/invite?token=${inviteToken}`;
            console.log(`\n📧 Team Invite for ${inviteEmail}:`);
            console.log(`   ${inviteLink}`);
            console.log(`   Role: ${role}`);
            console.log(`   Expires in 7 days\n`);
            
            return res.status(201).json({
                ok: true,
                inviteId,
                inviteEmail,
                role,
                inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined,
                expiresIn: '7 days'
            });
            
        } catch (err) {
            console.error('Failed to create invite:', err);
            return res.status(500).json({ error: 'Failed to create invite' });
        }
    }
    
    // List team members
    if (req.method === 'GET') {
        try {
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb query \
                --table-name clawops-team-members \
                --index-name orgEmail-index \
                --key-condition-expression "orgEmail = :email" \
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
            
            const members = (data.Items || [])
              .map(item => ({
                memberId: item.memberId?.S || item.membershipId?.S,
                email: item.memberEmail?.S || item.email?.S,
                role: item.role?.S,
                joinedAt: item.joinedAt?.S,
                lastActive: item.lastActive?.S || null
              }))
              .filter(m => m.email && m.email !== email); // exclude owner (added below) and incomplete records
            
            // Add owner (the account email)
            members.unshift({
                memberId: 'owner',
                email: email,
                role: 'owner',
                joinedAt: null,
                lastActive: new Date().toISOString()
            });
            
            return res.status(200).json({
                ok: true,
                members
            });
            
        } catch (err) {
            console.error('Failed to list team members:', err);
            // Return just owner on error
            return res.status(200).json({
                ok: true,
                members: [{
                    memberId: 'owner',
                    email: email,
                    role: 'owner',
                    joinedAt: null,
                    lastActive: new Date().toISOString()
                }]
            });
        }
    }
    
    // Remove team member
    if (req.method === 'DELETE') {
        const { memberId } = req.body || {};
        
        if (!memberId) {
            return res.status(400).json({ error: 'memberId is required' });
        }
        
        if (memberId === 'owner') {
            return res.status(400).json({ error: 'Cannot remove owner' });
        }
        
        try {
            const cmd = `AWS_ENDPOINT_URL=http://localhost:4566 aws dynamodb delete-item \
                --table-name clawops-team-members \
                --key '{"memberId":{"S":"${memberId}"}}'`;
            
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
                message: 'Team member removed'
            });
            
        } catch (err) {
            console.error('Failed to remove team member:', err);
            return res.status(500).json({ error: 'Failed to remove team member' });
        }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};
