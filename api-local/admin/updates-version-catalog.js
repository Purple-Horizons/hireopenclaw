const https = require('https');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../util/dynamodb.js');
const { requireAdmin } = require('../auth/middleware.js');

const DEFAULT_GITHUB_REPO = process.env.OPENCLAW_GITHUB_REPO || 'openclaw/openclaw';
const REQUEST_TIMEOUT_MS = Math.max(800, Number(process.env.OPENCLAW_VERSION_TIMEOUT_MS || 2200));
const MAX_SCAN_PAGES = Math.max(1, Number(process.env.OPENCLAW_VERSION_SCAN_PAGES || 20));

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [tenantSource, githubSource] = await Promise.all([
      getTenantVersionSource(),
      getGithubVersionSource(DEFAULT_GITHUB_REPO),
    ]);

    const merged = sortVersionsDesc([
      ...(githubSource.recentVersions || []),
      ...(tenantSource.recentVersions || []),
    ]);

    const recommendedVersion = githubSource.latest || tenantSource.latest || merged[0] || null;

    return res.json({
      ok: true,
      recommendedVersion,
      recentVersions: merged.slice(0, 5),
      sources: {
        github: githubSource,
        tenants: tenantSource,
      },
    });
  } catch (err) {
    console.error('[admin updates version-catalog] error:', err.message);
    return res.status(500).json({ error: 'Failed to load version catalog' });
  }
};

async function getTenantVersionSource() {
  const versions = new Set();
  let scanned = 0;
  let page = 0;
  let nextKey;

  while (page < MAX_SCAN_PAGES) {
    page += 1;
    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.TENANTS,
      ProjectionExpression: '#tenantId, #openClawVersion, #openclawVersion, #version, #imageUri, #image',
      ExpressionAttributeNames: {
        '#tenantId': 'tenantId',
        '#openClawVersion': 'openClawVersion',
        '#openclawVersion': 'openclawVersion',
        '#version': 'version',
        '#imageUri': 'imageUri',
        '#image': 'image',
      },
      ...(nextKey ? { ExclusiveStartKey: nextKey } : {}),
    }));

    const items = result.Items || [];
    scanned += items.length;

    for (const item of items) {
      const extracted = extractVersion(item);
      if (extracted) versions.add(extracted);
    }

    if (!result.LastEvaluatedKey) break;
    nextKey = result.LastEvaluatedKey;
  }

  const recent = sortVersionsDesc(Array.from(versions)).slice(0, 5);
  return {
    source: 'tenants',
    latest: recent[0] || null,
    recentVersions: recent,
    observedCount: versions.size,
    scanned,
  };
}

async function getGithubVersionSource(repo) {
  const cleanedRepo = String(repo || '').trim();
  if (!cleanedRepo) {
    return {
      source: 'github',
      configured: false,
      repo: null,
      latest: null,
      recentVersions: [],
      error: 'OPENCLAW_GITHUB_REPO is not configured.',
    };
  }

  try {
    const releaseData = await httpsGetJson(`https://api.github.com/repos/${cleanedRepo}/releases?per_page=8`);
    let rawTags = Array.isArray(releaseData)
      ? releaseData.map((item) => item?.tag_name).filter(Boolean)
      : [];

    if (!rawTags.length) {
      const tagsData = await httpsGetJson(`https://api.github.com/repos/${cleanedRepo}/tags?per_page=8`);
      rawTags = Array.isArray(tagsData)
        ? tagsData.map((item) => item?.name).filter(Boolean)
        : [];
    }

    const normalized = sortVersionsDesc(rawTags.map(normalizeVersion).filter(Boolean));

    return {
      source: 'github',
      configured: true,
      repo: cleanedRepo,
      latest: normalized[0] || null,
      recentVersions: normalized.slice(0, 5),
    };
  } catch (err) {
    return {
      source: 'github',
      configured: true,
      repo: cleanedRepo,
      latest: null,
      recentVersions: [],
      error: err.message,
    };
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'User-Agent': 'hireopenclaw-admin-version-catalog',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          reject(new Error('Invalid GitHub JSON response'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('GitHub request timeout'));
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function extractVersion(record) {
  if (!record || typeof record !== 'object') return null;

  const direct = [
    record.openClawVersion,
    record.openclawVersion,
    record.version,
  ];

  for (const value of direct) {
    const normalized = normalizeVersion(value);
    if (normalized) return normalized;
  }

  const image = String(record.imageUri || record.image || '').trim();
  if (!image) return null;
  const tag = image.includes(':') ? image.split(':').pop() : image;
  return normalizeVersion(tag);
}

function normalizeVersion(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const match = raw.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
  if (match?.[1]) return match[1];
  return null;
}

function parseComparableVersion(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function sortVersionsDesc(values) {
  const unique = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
  unique.sort((a, b) => {
    const va = parseComparableVersion(a);
    const vb = parseComparableVersion(b);
    if (va && vb) {
      if (va.major !== vb.major) return vb.major - va.major;
      if (va.minor !== vb.minor) return vb.minor - va.minor;
      if (va.patch !== vb.patch) return vb.patch - va.patch;
      return b.localeCompare(a);
    }
    if (va) return -1;
    if (vb) return 1;
    return b.localeCompare(a);
  });
  return unique;
}
