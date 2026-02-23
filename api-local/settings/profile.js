/**
 * User Profile API
 * GET /api/settings/profile  - Get profile fields from teams table
 * POST /api/settings/profile - Update profile fields on teams table
 */

const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { getEmailFromSession } = require('../auth/middleware.js');
const { ensureTeam } = require('../auth/team-plan.js');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LEN = 120;
const MAX_COMPANY_LEN = 120;
const TEAM_TABLE = TABLES.TEAMS || 'clawops-teams';

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSlug(input) {
  const slug = slugify(input);
  if (!slug) return '';
  return slug.slice(0, 32).replace(/^-+|-+$/g, '');
}

function buildSlugFromCompany(company) {
  const base = normalizeSlug(company);
  if (base.length >= 3) return base;
  return 'team';
}

function isValidSlug(slug) {
  return typeof slug === 'string'
    && slug.length >= 3
    && slug.length <= 32
    && SLUG_PATTERN.test(slug);
}

function toProfile(team, email) {
  return {
    name: team?.name || '',
    company: team?.company || '',
    slug: team?.slug || '',
    email,
  };
}

async function loadAllTeamRows() {
  const rows = [];
  let startKey;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TEAM_TABLE,
      ProjectionExpression: 'teamId, #slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));

    if (Array.isArray(result.Items)) rows.push(...result.Items);
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  return rows;
}

async function slugIsTaken(slug, teamId) {
  const rows = await loadAllTeamRows();
  return rows.some((row) => row?.slug === slug && row?.teamId !== teamId);
}

module.exports = async (req, res) => {
  const email = await getEmailFromSession(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const team = await ensureTeam(email, 'starter');
      return res.json(toProfile(team, email));
    } catch (err) {
      console.error('[Profile] GET error:', err.message);
      return res.status(500).json({ error: 'Failed to load profile' });
    }
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    const company = String(req.body?.company || '').trim();
    const requestedSlug = String(req.body?.slug || '').trim();

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!company) return res.status(400).json({ error: 'company is required' });
    if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: `name must be <= ${MAX_NAME_LEN} chars` });
    if (company.length > MAX_COMPANY_LEN) return res.status(400).json({ error: `company must be <= ${MAX_COMPANY_LEN} chars` });

    const slug = normalizeSlug(requestedSlug || buildSlugFromCompany(company));
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'slug must be 3-32 chars, lowercase letters, numbers, and hyphens only' });
    }

    try {
      const team = await ensureTeam(email, 'starter');
      if (!team?.teamId) return res.status(500).json({ error: 'Failed to resolve team' });

      const taken = await slugIsTaken(slug, team.teamId);
      if (taken) return res.status(409).json({ error: 'slug is already in use' });

      const updatedAt = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: TEAM_TABLE,
        Key: { teamId: team.teamId },
        UpdateExpression: 'SET #name = :name, company = :company, #slug = :slug, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#slug': 'slug',
        },
        ExpressionAttributeValues: {
          ':name': name,
          ':company': company,
          ':slug': slug,
          ':updatedAt': updatedAt,
        },
      }));

      return res.json({ ok: true, name, company, slug, email });
    } catch (err) {
      console.error('[Profile] POST error:', err.message);
      return res.status(500).json({ error: 'Failed to save profile' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
