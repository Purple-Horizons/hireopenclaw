/**
 * Admin API — Client Management
 * GET /api/admin/clients — List all clients with stats
 * GET /api/admin/clients/:email — Single client detail
 * PATCH /api/admin/clients/:email — Update client profile/team fields
 * GET /api/admin/clients/:email/team-members — List team members + invites
 * POST /api/admin/clients/:email/team-members — Invite team member
 * PATCH /api/admin/clients/:email/team-members/:memberId — Update role
 * DELETE /api/admin/clients/:email/team-members/:memberId — Remove member/revoke invite
 * PATCH /api/admin/clients/:email/tenants/:tenantId — Update tenant metadata
 * DELETE /api/admin/clients/:email/tenants/:tenantId — Archive tenant instance
 */

const crypto = require('crypto');
const { requireAdmin } = require('../auth/middleware.js');
const { ScanCommand, QueryCommand, UpdateCommand, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { validateEmail, validateTenantId, validateBotName, validatePlan } = require('../util/validate.js');
const { ensureTeam } = require('../auth/team-plan.js');

const TEAM_INVITES_TABLE = process.env.TEAM_INVITES_TABLE || 'clawops-team-invites';

const VALID_BOT_STATUSES = new Set(['active', 'paused', 'terminated', 'provisioning', 'error']);
const VALID_HEALTH_STATUSES = new Set(['healthy', 'unhealthy', 'pending', 'unknown']);
const VALID_MEMBER_ROLES = new Set(['admin', 'member', 'viewer']);
const SAFE_PHONE = /^[0-9+().\-\s]{5,32}$/;

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const targetEmail = req.params?.email;
    const targetTenantId = req.params?.tenantId;
    const targetMemberId = req.params?.memberId;
    const isTeamMembersRoute = req.path.includes('/team-members');

    if (targetEmail && !validateEmail(targetEmail)) {
      return res.status(400).json({ error: 'Invalid client email format' });
    }

    if (isTeamMembersRoute) {
      if (!targetEmail) return res.status(400).json({ error: 'Client email required' });

      if (targetMemberId) {
        if (req.method === 'PATCH') {
          return handleTeamMemberRoleUpdate(res, targetEmail, targetMemberId, req.body || {}, admin);
        }
        if (req.method === 'DELETE') {
          return handleTeamMemberDelete(res, targetEmail, targetMemberId);
        }
        return res.status(405).json({ error: 'Method not allowed' });
      }

      if (req.method === 'GET') {
        return handleTeamMembersList(res, targetEmail);
      }
      if (req.method === 'POST') {
        return handleTeamMemberInvite(res, targetEmail, req.body || {}, admin);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (targetTenantId) {
      if (req.method === 'PATCH') {
        return handleTenantUpdate(res, targetEmail, targetTenantId, req.body || {}, admin);
      }
      if (req.method === 'DELETE') {
        return handleTenantArchive(res, targetEmail, targetTenantId, admin);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (targetEmail) {
      if (req.method === 'PATCH') {
        return handleClientUpdate(res, targetEmail, req.body || {}, admin);
      }

      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const snapshot = await getClientSnapshot(targetEmail);
      if (!snapshot) return res.status(404).json({ error: 'Client not found' });
      const team = await getTeamForOwner(targetEmail);
      return res.json({ ok: true, client: snapshot, team });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Scan all tenants (acceptable for admin — small table)
    // Support pagination via cursor
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const cursor = parseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }
    const data = await docClient.send(new ScanCommand({
      TableName: TABLES.TENANTS,
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));
    const items = data.Items || [];

    const usageMap = await getMonthlyUsageByTenant(items.map((i) => i.tenantId));
    const clients = buildClients(items, usageMap);

    // Summary stats
    const summary = {
      totalClients: clients.length,
      activeClients: clients.filter((c) => c.activeBots > 0).length,
      totalBots: items.length,
      activeBots: items.filter((i) => i.status === 'active').length,
      terminatedBots: items.filter((i) => i.status === 'terminated').length,
      unhealthyBots: items.filter((i) => (i.healthStatus || 'unknown') === 'unhealthy').length,
      monthlyTokens: clients.reduce((sum, c) => sum + (c.usageMonth?.tokens || 0), 0),
      monthlyMessages: clients.reduce((sum, c) => sum + (c.usageMonth?.messages || 0), 0),
      monthlyCost: round2(clients.reduce((sum, c) => sum + (c.usageMonth?.cost || 0), 0)),
    };

    const nextCursor = data.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
      : null;

    return res.json({ ok: true, summary, clients, nextCursor });
  } catch (err) {
    console.error('[Admin] clients error:', err.message);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
};

async function handleClientUpdate(res, email, payload, adminEmail) {
  const tenants = await getTenantsByEmail(email);
  if (!tenants.length) return res.status(404).json({ error: 'Client not found' });

  const profilePatch = payload.profile || {};
  const teamPatch = payload.team || {};
  const profileUpdates = {};
  const teamUpdates = {};

  if (profilePatch.name !== undefined) {
    const contactName = String(profilePatch.name || '').trim();
    if (contactName.length > 120) {
      return res.status(400).json({ error: 'Invalid profile.name (max 120 chars)' });
    }
    profileUpdates.contactName = contactName;
  }

  if (profilePatch.phone !== undefined) {
    const contactPhone = String(profilePatch.phone || '').trim();
    if (contactPhone && !SAFE_PHONE.test(contactPhone)) {
      return res.status(400).json({ error: 'Invalid profile.phone format' });
    }
    profileUpdates.contactPhone = contactPhone;
    // Keep legacy field in sync for old dashboards that still read `phone`.
    profileUpdates.phone = contactPhone;
  }

  if (profilePatch.company !== undefined) {
    const company = String(profilePatch.company || '').trim();
    if (company.length > 120) {
      return res.status(400).json({ error: 'Invalid profile.company (max 120 chars)' });
    }
    profileUpdates.company = company;
  }

  if (teamPatch.name !== undefined) {
    const nextName = String(teamPatch.name || '').trim();
    if (!nextName || nextName.length > 120) {
      return res.status(400).json({ error: 'Invalid team.name (1-120 chars required)' });
    }
    teamUpdates.name = nextName;
  }

  if (teamPatch.plan !== undefined) {
    if (!validatePlan(teamPatch.plan)) return res.status(400).json({ error: 'Invalid team.plan' });
    teamUpdates.plan = teamPatch.plan;
  }

  if (teamPatch.seats !== undefined) {
    const seats = Number(teamPatch.seats);
    if (!Number.isFinite(seats) || seats < 1 || seats > 1000) {
      return res.status(400).json({ error: 'Invalid team.seats (must be 1-1000)' });
    }
    teamUpdates.seats = Math.floor(seats);
  }

  if (payload.adminNotes !== undefined) {
    const notes = String(payload.adminNotes || '').trim();
    if (notes.length > 2000) return res.status(400).json({ error: 'adminNotes too long (max 2000 chars)' });
    teamUpdates.adminNotes = notes;
  }

  const hasProfileUpdates = Object.keys(profileUpdates).length > 0;
  const hasTeamUpdates = Object.keys(teamUpdates).length > 0;

  if (!hasProfileUpdates && !hasTeamUpdates) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  if (hasProfileUpdates) {
    await Promise.all(
      tenants.map((tenant) => updateTenantFields(tenant.tenantId, profileUpdates, adminEmail))
    );
  }

  if (hasTeamUpdates) {
    let team = await getTeamForOwner(email);
    if (!team?.teamId) {
      const seedPlan = teamUpdates.plan && validatePlan(teamUpdates.plan) ? teamUpdates.plan : 'starter';
      team = await ensureTeam(email, seedPlan);
    }
    await updateTeamFields(team.teamId, teamUpdates, adminEmail);
  }

  const snapshot = await getClientSnapshot(email);
  const refreshedTeam = await getTeamForOwner(email);
  return res.json({ ok: true, client: snapshot, team: refreshedTeam });
}

async function handleTeamMembersList(res, email) {
  const team = await getTeamForOwner(email);
  const members = [
    {
      memberId: 'owner',
      email,
      role: 'owner',
      status: 'active',
      source: 'owner',
      joinedAt: team?.createdAt || null,
    }
  ];

  const membershipRows = await queryByOrgEmail(TABLES.TEAM_MEMBERS, email);
  for (const row of membershipRows) {
    const memberEmail = row.memberEmail || row.email || row.userEmail;
    if (!memberEmail) continue;
    if (memberEmail.toLowerCase() === email.toLowerCase() && row.role === 'owner') continue;

    members.push({
      memberId: row.membershipId || row.memberId,
      email: memberEmail,
      role: row.role || 'member',
      status: row.status || 'active',
      source: 'member',
      joinedAt: row.joinedAt || row.createdAt || null,
      invitedAt: row.invitedAt || null,
      invitedBy: row.invitedBy || null,
    });
  }

  const invites = await queryByOrgEmail(TEAM_INVITES_TABLE, email);
  for (const invite of invites) {
    if (invite.accepted) continue;
    members.push({
      memberId: `invite:${invite.inviteId}`,
      email: invite.inviteEmail,
      role: invite.role || 'member',
      status: invite.expiresAt && Date.parse(invite.expiresAt) < Date.now() ? 'expired' : 'pending',
      source: 'invite',
      invitedAt: invite.createdAt || null,
      expiresAt: invite.expiresAt || null,
      invitedBy: invite.createdBy || invite.orgEmail,
    });
  }

  return res.json({ ok: true, team, members });
}

async function handleTeamMemberInvite(res, email, payload, adminEmail) {
  const inviteEmail = String(payload.inviteEmail || '').trim().toLowerCase();
  const role = String(payload.role || 'member').trim().toLowerCase();

  if (!inviteEmail) return res.status(400).json({ error: 'inviteEmail is required' });
  if (!validateEmail(inviteEmail)) return res.status(400).json({ error: 'Valid inviteEmail is required' });
  if (inviteEmail === email.toLowerCase()) return res.status(400).json({ error: 'Cannot invite owner email' });
  if (!VALID_MEMBER_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_MEMBER_ROLES].join(', ')}` });
  }

  const members = await queryByOrgEmail(TABLES.TEAM_MEMBERS, email);
  if (members.some((m) => (m.memberEmail || m.email || '').toLowerCase() === inviteEmail && m.status !== 'removed')) {
    return res.status(400).json({ error: 'User already exists as a team member' });
  }

  const invites = await queryByOrgEmail(TEAM_INVITES_TABLE, email);
  if (invites.some((i) => (i.inviteEmail || '').toLowerCase() === inviteEmail && !i.accepted)) {
    return res.status(400).json({ error: 'User already has a pending invite' });
  }

  const now = new Date();
  const inviteId = crypto.randomBytes(16).toString('hex');
  const inviteToken = crypto.randomBytes(32).toString('hex');

  await docClient.send(new PutCommand({
    TableName: TEAM_INVITES_TABLE,
    Item: {
      inviteId,
      orgEmail: email,
      inviteEmail,
      role,
      inviteToken,
      createdAt: now.toISOString(),
      createdBy: adminEmail,
      expiresAt: new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString(),
      accepted: false,
      source: 'admin',
    },
  }));

  return res.status(201).json({ ok: true, inviteId, inviteEmail, role });
}

async function handleTeamMemberRoleUpdate(res, email, memberId, payload, adminEmail) {
  const role = String(payload.role || '').trim().toLowerCase();
  if (!VALID_MEMBER_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_MEMBER_ROLES].join(', ')}` });
  }

  if (memberId.startsWith('invite:')) {
    const inviteId = memberId.replace('invite:', '');
    const invite = await docClient.send(new GetCommand({
      TableName: TEAM_INVITES_TABLE,
      Key: { inviteId },
    }));

    if (!invite.Item || invite.Item.orgEmail !== email) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    await docClient.send(new UpdateCommand({
      TableName: TEAM_INVITES_TABLE,
      Key: { inviteId },
      UpdateExpression: 'SET #role = :role, updatedAt = :now, updatedBy = :admin',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: {
        ':role': role,
        ':now': new Date().toISOString(),
        ':admin': adminEmail,
      },
    }));

    return res.json({ ok: true, updated: true, memberId });
  }

  const member = await docClient.send(new GetCommand({
    TableName: TABLES.TEAM_MEMBERS,
    Key: { membershipId: memberId },
  }));

  if (!member.Item || member.Item.orgEmail !== email) {
    return res.status(404).json({ error: 'Team member not found' });
  }
  if (member.Item.role === 'owner') {
    return res.status(400).json({ error: 'Cannot change owner role' });
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TEAM_MEMBERS,
    Key: { membershipId: memberId },
    UpdateExpression: 'SET #role = :role, updatedAt = :now, updatedBy = :admin',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: {
      ':role': role,
      ':now': new Date().toISOString(),
      ':admin': adminEmail,
    },
  }));

  return res.json({ ok: true, updated: true, memberId });
}

async function handleTeamMemberDelete(res, email, memberId) {
  if (memberId === 'owner') {
    return res.status(400).json({ error: 'Cannot remove owner' });
  }

  if (memberId.startsWith('invite:')) {
    const inviteId = memberId.replace('invite:', '');
    const invite = await docClient.send(new GetCommand({
      TableName: TEAM_INVITES_TABLE,
      Key: { inviteId },
    }));

    if (!invite.Item || invite.Item.orgEmail !== email) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    await docClient.send(new DeleteCommand({
      TableName: TEAM_INVITES_TABLE,
      Key: { inviteId },
    }));

    return res.json({ ok: true, removed: true, memberId });
  }

  const member = await docClient.send(new GetCommand({
    TableName: TABLES.TEAM_MEMBERS,
    Key: { membershipId: memberId },
  }));

  if (!member.Item || member.Item.orgEmail !== email) {
    return res.status(404).json({ error: 'Team member not found' });
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLES.TEAM_MEMBERS,
    Key: { membershipId: memberId },
  }));

  return res.json({ ok: true, removed: true, memberId });
}

async function handleTenantUpdate(res, email, tenantId, payload, adminEmail) {
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid client email format' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  const tenant = await getTenantOwnedBy(email, tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found for client' });

  const updates = {};
  if (payload.name !== undefined) {
    if (!validateBotName(payload.name)) {
      return res.status(400).json({ error: 'Invalid tenant name format' });
    }
    updates.name = payload.name;
  }

  if (payload.status !== undefined) {
    const status = String(payload.status || '').trim();
    if (!VALID_BOT_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid tenant status (${[...VALID_BOT_STATUSES].join(', ')})` });
    }
    updates.status = status;
  }

  if (payload.healthStatus !== undefined) {
    const health = String(payload.healthStatus || '').trim();
    if (!VALID_HEALTH_STATUSES.has(health)) {
      return res.status(400).json({ error: `Invalid healthStatus (${[...VALID_HEALTH_STATUSES].join(', ')})` });
    }
    updates.healthStatus = health;
  }

  if (payload.role !== undefined) {
    const role = String(payload.role || '').trim();
    if (!role || role.length > 80) {
      return res.status(400).json({ error: 'Invalid role (1-80 chars required)' });
    }
    updates.role = role;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid tenant fields provided for update' });
  }

  await updateTenantFields(tenantId, updates, adminEmail);
  const refreshed = await getTenantOwnedBy(email, tenantId);
  return res.json({ ok: true, tenant: toTenantView(refreshed) });
}

async function handleTenantArchive(res, email, tenantId, adminEmail) {
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid client email format' });
  if (!validateTenantId(tenantId)) return res.status(400).json({ error: 'Invalid tenantId format' });

  const tenant = await getTenantOwnedBy(email, tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found for client' });

  const now = new Date().toISOString();
  await docClient.send(new UpdateCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
    UpdateExpression: 'SET #status = :status, archivedAt = :now, updatedAt = :now, updatedBy = :admin',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'terminated',
      ':now': now,
      ':admin': adminEmail,
    },
  }));

  return res.json({ ok: true, archived: true, tenantId });
}

async function getClientSnapshot(email) {
  const items = await getTenantsByEmail(email);
  if (!items.length) return null;
  const usageMap = await getMonthlyUsageByTenant(items.map((i) => i.tenantId));
  const clients = buildClients(items, usageMap);
  return clients[0] || null;
}

async function getTenantsByEmail(email) {
  const byEmail = await docClient.send(new QueryCommand({
    TableName: TABLES.TENANTS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
  }));
  return byEmail.Items || [];
}

async function getTenantOwnedBy(email, tenantId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
  }));
  if (!result.Item) return null;
  if (result.Item.email !== email) return null;
  return result.Item;
}

async function updateTenantFields(tenantId, updates, adminEmail) {
  const now = new Date().toISOString();
  const names = {};
  const values = { ':now': now, ':admin': adminEmail };
  const clauses = ['updatedAt = :now', 'updatedBy = :admin'];

  let idx = 0;
  for (const [key, value] of Object.entries(updates)) {
    idx += 1;
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    names[nameKey] = key;
    values[valueKey] = value;
    clauses.push(`${nameKey} = ${valueKey}`);
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TENANTS,
    Key: { tenantId },
    UpdateExpression: `SET ${clauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function updateTeamFields(teamId, updates, adminEmail) {
  const now = new Date().toISOString();
  const names = {};
  const values = { ':now': now, ':admin': adminEmail };
  const clauses = ['updatedAt = :now', 'updatedBy = :admin'];

  let idx = 0;
  for (const [key, value] of Object.entries(updates)) {
    idx += 1;
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    names[nameKey] = key;
    values[valueKey] = value;
    clauses.push(`${nameKey} = ${valueKey}`);
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.TEAMS || 'clawops-teams',
    Key: { teamId },
    UpdateExpression: `SET ${clauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function queryByOrgEmail(tableName, orgEmail) {
  try {
    const byIndex = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'orgEmail-index',
      KeyConditionExpression: 'orgEmail = :email',
      ExpressionAttributeValues: { ':email': orgEmail },
    }));
    return byIndex.Items || [];
  } catch (err) {
    try {
      const scanned = await docClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'orgEmail = :email',
        ExpressionAttributeValues: { ':email': orgEmail },
      }));
      return scanned.Items || [];
    } catch {
      return [];
    }
  }
}

function toTenantView(item) {
  if (!item) return null;
  return {
    tenantId: item.tenantId,
    email: item.email,
    name: item.botName || item.name || item.tenantId,
    status: item.status || 'unknown',
    healthStatus: item.healthStatus || 'unknown',
    openClawVersion: pickFirstNonEmpty(item.openClawVersion, item.openclawVersion, item.version, null),
    lastUpdateStatus: pickFirstNonEmpty(item.lastUpdateStatus, item.updateStatus, null),
    lastUpdateTime: pickFirstNonEmpty(item.lastUpdateTime, item.lastUpdateAt, item.lastUpdatedAt, null),
    role: item.role || null,
    updatedAt: item.updatedAt || null,
    updatedBy: item.updatedBy || null,
  };
}

async function getTeamForOwner(email) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.TEAMS || 'clawops-teams',
      IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId = :owner',
      ExpressionAttributeValues: { ':owner': email },
      Limit: 1,
    }));
    if (!result.Items?.length) return null;
    const team = result.Items[0];
    return {
      teamId: team.teamId,
      ownerId: team.ownerId || email,
      name: team.name || null,
      plan: team.plan || null,
      seats: Number.isFinite(team.seats) ? team.seats : null,
      adminNotes: team.adminNotes || '',
      createdAt: team.createdAt || null,
      updatedAt: team.updatedAt || null,
      updatedBy: team.updatedBy || null,
      lastLoginAt: team.lastLoginAt || team.lastLogin || team.lastSeenAt || null,
    };
  } catch (err) {
    console.warn('[Admin] team lookup failed:', err.message);
    return null;
  }
}

function buildClients(items, usageMap) {
  const clientMap = {};

  for (const item of items) {
    const email = item.email || 'unknown';
    const status = item.status || 'unknown';
    const tenantId = item.tenantId;
    const name = item.botName || item.name || tenantId;
    const createdAt = item.createdAt || item.provisionedAt;
    const health = item.healthStatus || 'unknown';
    const openClawVersion = pickFirstNonEmpty(item.openClawVersion, item.openclawVersion, item.version, null);
    const lastUpdateStatus = pickFirstNonEmpty(item.lastUpdateStatus, item.updateStatus, null);
    const lastUpdateTime = pickFirstNonEmpty(item.lastUpdateTime, item.lastUpdateAt, item.lastUpdatedAt, null);
    const role = item.role || null;
    const endpoint = item.endpoint;
    const port = item.port;
    const usage = usageMap[tenantId] || { tokens: 0, messages: 0, cost: 0, lastRequestAt: null };

    if (!clientMap[email]) {
      clientMap[email] = {
        email,
        profile: {
          name: null,
          phone: null,
          company: null,
        },
        bots: [],
        totalBots: 0,
        activeBots: 0,
        firstSeen: createdAt || null,
        lastActive: createdAt || null,
        usageMonth: { tokens: 0, messages: 0, cost: 0 },
      };
    }

    const client = clientMap[email];
    client.totalBots++;
    if (status === 'active') client.activeBots++;
    if (createdAt && (!client.firstSeen || toEpochMs(createdAt) < toEpochMs(client.firstSeen))) client.firstSeen = createdAt;

    if (!client.profile.name) {
      client.profile.name = pickFirstNonEmpty(item.contactName, item.customerName, item.ownerName, item.fullName, null);
    }
    if (!client.profile.phone) {
      client.profile.phone = pickFirstNonEmpty(item.contactPhone, item.phone, item.phoneNumber, item.mobile, null);
    }
    if (!client.profile.company) {
      client.profile.company = pickFirstNonEmpty(item.company, item.companyName, item.organization, null);
    }

    const botLastActive = usage.lastRequestAt || createdAt || null;
    if (botLastActive && (!client.lastActive || toEpochMs(botLastActive) > toEpochMs(client.lastActive))) {
      client.lastActive = botLastActive;
    }

    client.usageMonth.tokens += usage.tokens;
    client.usageMonth.messages += usage.messages;
    client.usageMonth.cost += usage.cost;

    client.bots.push({
      tenantId,
      name,
      status,
      health,
      role,
      endpoint,
      port: port ? parseInt(port, 10) : null,
      openClawVersion,
      lastUpdateStatus,
      lastUpdateTime,
      createdAt,
      lastRequestAt: usage.lastRequestAt || null,
      usageMonth: {
        tokens: usage.tokens,
        messages: usage.messages,
        cost: round2(usage.cost),
      },
    });
  }

  return Object.values(clientMap)
    .map((client) => ({
      ...client,
      usageMonth: {
        tokens: client.usageMonth.tokens,
        messages: client.usageMonth.messages,
        cost: round2(client.usageMonth.cost),
      }
    }))
    .sort((a, b) => {
      if (a.activeBots !== b.activeBots) return b.activeBots - a.activeBots;
      return (b.lastActive || '').localeCompare(a.lastActive || '');
    });
}

async function getMonthlyUsageByTenant(tenantIds) {
  const map = {};
  const now = new Date();
  const monthStartMs = Date.UTC(now.getFullYear(), now.getMonth(), 1);

  await Promise.all((tenantIds || []).filter(Boolean).map(async (tenantId) => {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.USAGE,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
      }));

      let tokens = 0;
      let messages = 0;
      let cost = 0;
      let lastRequestMs = null;

      for (const row of (result.Items || [])) {
        const ts = toRecordTimestampMs(row);
        if (ts !== null && ts < monthStartMs) continue;
        if (ts !== null && (lastRequestMs === null || ts > lastRequestMs)) lastRequestMs = ts;

        const input = toNum(
          row.inputTokens, row.tokensIn, row.tokenIn, row.promptTokens, row.prompt_tokens, row.inputTokenCount, row.totalInputTokens, row.tokens_input
        ) || 0;
        const output = toNum(
          row.outputTokens, row.tokensOut, row.tokenOut, row.completionTokens, row.completion_tokens, row.outputTokenCount, row.totalOutputTokens, row.tokens_output
        ) || 0;
        const msg = toNum(row.messageCount, row.messages, row.requestCount, row.requests, row.totalRequests, row.message_count) || 0;
        const rowCost = toNum(row.cost, row.totalCost, row.costUsd, row.costUSD, row.estimatedCost);

        tokens += input + output;
        messages += msg;
        cost += rowCost !== null ? rowCost : estimateCost(input, output);
      }

      map[tenantId] = {
        tokens,
        messages,
        cost: round2(cost),
        lastRequestAt: lastRequestMs !== null ? new Date(lastRequestMs).toISOString() : null,
      };
    } catch (err) {
      console.warn(`[Admin] usage lookup failed for ${tenantId}:`, err.message);
      map[tenantId] = { tokens: 0, messages: 0, cost: 0, lastRequestAt: null };
    }
  }));

  return map;
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function toNum(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function toRecordTimestampMs(row) {
  const ts = toNum(row.timestamp);
  if (ts !== null) return ts > 1_000_000_000_000 ? ts : ts * 1000;

  for (const field of [row.date, row.lastUpdated, row.updatedAt, row.createdAt]) {
    if (!field) continue;
    const numeric = toNum(field);
    if (numeric !== null) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(field);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function estimateCost(inputTokens, outputTokens) {
  return ((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toEpochMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString();
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
