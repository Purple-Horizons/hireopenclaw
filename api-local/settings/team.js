/**
 * Team Management
 * POST /api/settings/team - Invite team member
 * GET /api/settings/team - List team members + pending invites
 * DELETE /api/settings/team - Remove member or revoke invite
 */

const crypto = require('crypto');
const { QueryCommand, PutCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { getEmailFromSession } = require('../auth/middleware.js');
const { validateEmail } = require('../util/validate.js');

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const INVITES_TABLE = 'clawops-team-invites';
const MEMBERS_TABLE = TABLES.TEAM_MEMBERS;

module.exports = async (req, res) => {
    const email = await getEmailFromSession(req);
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    // ── POST: Invite team member ──
    if (req.method === 'POST') {
        const { inviteEmail, role, message } = req.body || {};
        const normalizedInviteEmail = String(inviteEmail || '').trim().toLowerCase();
        const portalBaseUrl = (process.env.PORTAL_URL || process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

        if (!normalizedInviteEmail) {
            return res.status(400).json({ error: 'inviteEmail is required' });
        }
        if (!validateEmail(normalizedInviteEmail)) {
            return res.status(400).json({ error: 'Valid inviteEmail is required' });
        }
        if (normalizedInviteEmail === email.toLowerCase()) {
            return res.status(400).json({ error: 'Cannot invite your own email' });
        }
        if (!ROLES.includes(role)) {
            return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
        }

        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteId = crypto.randomBytes(16).toString('hex');

        try {
            await docClient.send(new PutCommand({
                TableName: INVITES_TABLE,
                Item: {
                    inviteId,
                    orgEmail: email,
                    inviteEmail: normalizedInviteEmail,
                    role,
                    inviteToken,
                    message: typeof message === 'string' ? message.slice(0, 2000) : '',
                    createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    accepted: false
                }
            }));

            const inviteLink = `${portalBaseUrl}/invite?token=${inviteToken}`;
            console.log(`\n📧 Team Invite for ${normalizedInviteEmail}:`);
            console.log(`   ${inviteLink}`);
            console.log(`   Role: ${role}`);
            console.log(`   Expires in 7 days\n`);

            return res.status(201).json({
                ok: true,
                inviteId,
                inviteEmail: normalizedInviteEmail,
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
            const result = await docClient.send(new QueryCommand({
                TableName: MEMBERS_TABLE,
                IndexName: 'orgEmail-index',
                KeyConditionExpression: 'orgEmail = :email',
                ExpressionAttributeValues: {
                    ':email': email
                }
            }));

            for (const item of (result.Items || [])) {
                const memberEmail = item.memberEmail || item.email;
                if (!memberEmail || memberEmail === email) continue;
                members.push({
                    memberId: item.memberId || item.membershipId,
                    email: memberEmail,
                    role: item.role,
                    status: 'active',
                    joinedAt: item.joinedAt,
                    lastActive: item.lastActive || null
                });
            }
        } catch (err) {
            console.error('Failed to list team members:', err.message);
        }

        // Pending invites
        try {
            const result = await docClient.send(new QueryCommand({
                TableName: INVITES_TABLE,
                IndexName: 'orgEmail-index',
                KeyConditionExpression: 'orgEmail = :email',
                ExpressionAttributeValues: {
                    ':email': email
                }
            }));
            const now = new Date();
            for (const item of (result.Items || [])) {
                if (item.accepted) continue; // skip accepted
                const expiresAt = item.expiresAt ? new Date(item.expiresAt) : null;
                const expired = expiresAt && expiresAt < now;
                members.push({
                    memberId: `invite:${item.inviteId}`,
                    email: item.inviteEmail,
                    role: item.role,
                    status: expired ? 'expired' : 'pending',
                    createdAt: item.createdAt,
                    expiresAt: item.expiresAt
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
                const invite = await docClient.send(new GetCommand({
                    TableName: INVITES_TABLE,
                    Key: { inviteId }
                }));
                if (!invite.Item || invite.Item.orgEmail !== email) {
                    return res.status(404).json({ error: 'Invite not found' });
                }
                await docClient.send(new DeleteCommand({
                    TableName: INVITES_TABLE,
                    Key: { inviteId }
                }));
                return res.status(200).json({ ok: true, message: 'Invite revoked' });
            } else {
                // Remove accepted member
                const member = await docClient.send(new GetCommand({
                    TableName: MEMBERS_TABLE,
                    Key: { membershipId: memberId }
                }));
                if (!member.Item || member.Item.orgEmail !== email) {
                    return res.status(404).json({ error: 'Team member not found' });
                }
                await docClient.send(new DeleteCommand({
                    TableName: MEMBERS_TABLE,
                    Key: { membershipId: memberId }
                }));
                return res.status(200).json({ ok: true, message: 'Team member removed' });
            }
        } catch (err) {
            console.error('Failed to remove:', err.message);
            return res.status(500).json({ error: 'Failed to remove team member' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
