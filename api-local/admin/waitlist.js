/**
 * Admin waitlist management
 *   GET  /api/admin/waitlist
 *   POST /api/admin/waitlist/activate
 *   POST /api/admin/waitlist/reject
 */

const { ScanCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireAdmin } = require('../auth/middleware.js');
const { ensureTeam } = require('../auth/team-plan.js');
const { createMagicLink, sendMagicLinkEmail } = require('../auth/magic-link.js');
const { validateEmail, validatePlan } = require('../util/validate.js');
const { docClient } = require('../util/dynamodb.js');

const WAITLIST_TABLE = process.env.WAITLIST_TABLE || 'clawops-waitlist';

function normalizeWaitlistStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'pending';
  if (value === 'activated' || value === 'rejected' || value === 'pending') return value;
  return 'pending';
}

function formatWaitlistItem(item) {
  const firstName = String(item.firstName || '').trim();
  const lastName = String(item.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return {
    email: item.email || '',
    name: fullName || item.name || '',
    firstName,
    lastName,
    phone: item.phone || '',
    createdAt: item.createdAt || null,
    status: normalizeWaitlistStatus(item.status),
    source: item.source || null,
    plan: item.plan || null,
    activatedAt: item.activatedAt || null,
    rejectedAt: item.rejectedAt || null,
  };
}

async function scanAllWaitlistItems() {
  let lastKey;
  const rows = [];

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: WAITLIST_TABLE,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    rows.push(...(response.Items || []));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);

  return rows;
}

async function getWaitlistItem(email) {
  const response = await docClient.send(new GetCommand({
    TableName: WAITLIST_TABLE,
    Key: { email },
  }));
  return response.Item || null;
}

async function activateWaitlistEntry(email, plan, adminEmail) {
  const existing = await getWaitlistItem(email);
  if (!existing) return { ok: false, status: 404, error: 'Waitlist entry not found' };

  await ensureTeam(email, plan);
  const { magicLink, expiresAt } = createMagicLink(email);
  await sendMagicLinkEmail(email, magicLink);

  await docClient.send(new UpdateCommand({
    TableName: WAITLIST_TABLE,
    Key: { email },
    UpdateExpression: 'SET #status = :status, #plan = :plan, activatedAt = :activatedAt, activatedBy = :activatedBy, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#plan': 'plan',
    },
    ExpressionAttributeValues: {
      ':status': 'activated',
      ':plan': plan,
      ':activatedAt': new Date().toISOString(),
      ':activatedBy': adminEmail,
      ':updatedAt': new Date().toISOString(),
    },
  }));

  return { ok: true, email, plan, magicLink, expiresAt };
}

async function rejectWaitlistEntry(email, adminEmail) {
  const existing = await getWaitlistItem(email);
  if (!existing) return { ok: false, status: 404, error: 'Waitlist entry not found' };

  await docClient.send(new UpdateCommand({
    TableName: WAITLIST_TABLE,
    Key: { email },
    UpdateExpression: 'SET #status = :status, rejectedAt = :rejectedAt, rejectedBy = :rejectedBy, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'rejected',
      ':rejectedAt': new Date().toISOString(),
      ':rejectedBy': adminEmail,
      ':updatedAt': new Date().toISOString(),
    },
  }));

  return { ok: true, email };
}

async function handleAdminWaitlistList(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const items = await scanAllWaitlistItems();
  const waitlist = items
    .map(formatWaitlistItem)
    .sort((a, b) => {
      const at = Date.parse(a.createdAt || '') || 0;
      const bt = Date.parse(b.createdAt || '') || 0;
      return bt - at;
    });

  return res.json({ ok: true, waitlist, count: waitlist.length });
}

async function handleAdminWaitlistActivate(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const email = String(req.body?.email || '').trim().toLowerCase();
  const plan = String(req.body?.plan || '').trim().toLowerCase();

  if (!validateEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!plan || !validatePlan(plan)) return res.status(400).json({ error: 'Valid plan is required' });

  const result = await activateWaitlistEntry(email, plan, admin);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Activation failed' });

  return res.json({
    ok: true,
    email: result.email,
    plan: result.plan,
    expiresAt: result.expiresAt,
  });
}

async function handleAdminWaitlistReject(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validateEmail(email)) return res.status(400).json({ error: 'Valid email is required' });

  const result = await rejectWaitlistEntry(email, admin);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Reject failed' });

  return res.json({ ok: true, email: result.email, status: 'rejected' });
}

module.exports = {
  handleAdminWaitlistList,
  handleAdminWaitlistActivate,
  handleAdminWaitlistReject,
  __private: {
    scanAllWaitlistItems,
    formatWaitlistItem,
    normalizeWaitlistStatus,
  },
};
