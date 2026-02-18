/**
 * Team Management
 * POST /api/settings/team - Invite team member
 * GET /api/settings/team - List team members + pending invites
 * DELETE /api/settings/team - Remove member or revoke invite
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const DYNAMO_ENV = {
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_DEFAULT_REGION: 'us-east-1'
};

function dynamoExec(cmd) {
    return execSync(`AWS_ENDPOINT_URL=http://localhost:4566 ${cmd}`, {
        encoding: 'utf8',
        env: { ...process.env, ...DYNAMO_ENV }
    });
}

module.exports = async (req, res) => {
    const email = req.query.email || (req.body && req.body.email);

    if (!email) {
        return res.status(400).json({ error: 'email is required' });
    }

    // ── POST: Invite team member ──
    if (req.method === 'POST') {
        const { inviteEmail, role, message } = req.body || {};

        if (!inviteEmail) {
            return res.status(400).json({ error: 'inviteEmail is required' });
        }
        if (!ROLES.includes(role)) {
            return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
        }

        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteId = crypto.randomBytes(16).toString('hex');

        try {
            dynamoExec(`aws dynamodb put-item \
                --table-name clawops-team-invites \
                --item '{
                    "inviteId": {"S": "${inviteId}"},
                    "orgEmail": {"S": "${email}"},
                    "inviteEmail": {"S": "${inviteEmail}"},
                    "role": {"S": "${role}"},
                    "inviteToken": {"S": "${inviteToken}"},
                    "message": {"S": "${(message || '').replace(/'/g, '')}"},
                    "createdAt": {"S": "${new Date().toISOString()}"},
                    "expiresAt": {"S": "${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()}"},
                    "accepted": {"BOOL": false}
                }'`);

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
            console.error('Failed to create invite:', err.message);
            return res.status(500).json({ error: 'Failed to create invite' });
        }
    }

    // ── GET: List members + pending invites ──
    if (req.method === 'GET') {
        const members = [];

        // Owner always first
        members.push({
            memberId: 'owner',
            email: email,
            role: 'owner',
            status: 'active',
            joinedAt: null,
            lastActive: new Date().toISOString()
        });

        // Accepted members
        try {
            const result = dynamoExec(`aws dynamodb query \
                --table-name clawops-team-members \
                --index-name orgEmail-index \
                --key-condition-expression "orgEmail = :email" \
                --expression-attribute-values '{":email":{"S":"${email}"}}' \
                --output json`);

            const data = JSON.parse(result);
            for (const item of (data.Items || [])) {
                const memberEmail = item.memberEmail?.S || item.email?.S;
                if (!memberEmail || memberEmail === email) continue;
                members.push({
                    memberId: item.memberId?.S || item.membershipId?.S,
                    email: memberEmail,
                    role: item.role?.S,
                    status: 'active',
                    joinedAt: item.joinedAt?.S,
                    lastActive: item.lastActive?.S || null
                });
            }
        } catch (err) {
            console.error('Failed to list team members:', err.message);
        }

        // Pending invites
        try {
            const result = dynamoExec(`aws dynamodb query \
                --table-name clawops-team-invites \
                --index-name orgEmail-index \
                --key-condition-expression "orgEmail = :email" \
                --expression-attribute-values '{":email":{"S":"${email}"}}' \
                --output json`);

            const data = JSON.parse(result);
            const now = new Date();
            for (const item of (data.Items || [])) {
                if (item.accepted?.BOOL) continue; // skip accepted
                const expiresAt = item.expiresAt?.S ? new Date(item.expiresAt.S) : null;
                const expired = expiresAt && expiresAt < now;
                members.push({
                    memberId: `invite:${item.inviteId?.S}`,
                    email: item.inviteEmail?.S,
                    role: item.role?.S,
                    status: expired ? 'expired' : 'pending',
                    createdAt: item.createdAt?.S,
                    expiresAt: item.expiresAt?.S
                });
            }
        } catch (err) {
            console.error('Failed to list invites:', err.message);
        }

        return res.status(200).json({ ok: true, members });
    }

    // ── DELETE: Remove member or revoke invite ──
    if (req.method === 'DELETE') {
        const { memberId } = req.body || {};

        if (!memberId) {
            return res.status(400).json({ error: 'memberId is required' });
        }
        if (memberId === 'owner') {
            return res.status(400).json({ error: 'Cannot remove owner' });
        }

        try {
            if (memberId.startsWith('invite:')) {
                // Revoke invite
                const inviteId = memberId.replace('invite:', '');
                dynamoExec(`aws dynamodb delete-item \
                    --table-name clawops-team-invites \
                    --key '{"inviteId":{"S":"${inviteId}"}}'`);
                return res.status(200).json({ ok: true, message: 'Invite revoked' });
            } else {
                // Remove accepted member
                dynamoExec(`aws dynamodb delete-item \
                    --table-name clawops-team-members \
                    --key '{"membershipId":{"S":"${memberId}"}}'`);
                return res.status(200).json({ ok: true, message: 'Team member removed' });
            }
        } catch (err) {
            console.error('Failed to remove:', err.message);
            return res.status(500).json({ error: 'Failed to remove team member' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
