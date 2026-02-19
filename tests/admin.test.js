/**
 * Unit tests for admin auth, secrets encryption, and impersonation
 */




const tokenStore = require('../api-local/auth/token-store.js');
const { isAdmin, getSessionTokenFromRequest, getEmailFromSession, getEffectiveEmail, requireAuth, ADMIN_EMAILS } = require('../api-local/auth/middleware.js');

// ─── Admin Auth ───

describe('Admin Auth', () => {
  test('g@purplehorizons.io is admin', async () => {
    expect(isAdmin('g@purplehorizons.io')).toBe(true);
  });

  test('case insensitive admin check', async () => {
    expect(isAdmin('G@purplehorizons.io')).toBe(true);
    expect(isAdmin('G@PURPLEHORIZONS.IO')).toBe(true);
  });

  test('random email is not admin', async () => {
    expect(isAdmin('test@test.com')).toBe(false);
    expect(isAdmin('admin@evil.com')).toBe(false);
  });

  test('null/undefined is not admin', async () => {
    expect(!isAdmin(null)).toBeTruthy();
    expect(!isAdmin(undefined)).toBeTruthy();
    expect(!isAdmin('')).toBeTruthy();
  });

  test('gianni@purplehorizons.io is NOT admin (removed)', async () => {
    expect(isAdmin('gianni@purplehorizons.io')).toBe(false);
  });

  test('only expected emails in allowlist', async () => {
    expect(ADMIN_EMAILS.size).toBe(1);
    expect(ADMIN_EMAILS.has('g@purplehorizons.io')).toBeTruthy();
  });
});

// ─── Impersonation ───

describe('Impersonation', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  test('getEffectiveEmail returns session email normally', async () => {
    tokenStore.set('sess123', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=sess123' } };
    expect(await getEffectiveEmail(req)).toBe('g@purplehorizons.io');
  });

  test('getEffectiveEmail returns impersonated email for admin', async () => {
    tokenStore.set('sess123', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000, impersonating: 'client@test.com' });
    const req = { headers: { cookie: 'session=sess123' } };
    expect(await getEffectiveEmail(req)).toBe('client@test.com');
  });

  test('getEffectiveEmail ignores impersonation for non-admin', async () => {
    tokenStore.set('sess456', { type: 'session', email: 'test@test.com', expiresAt: Date.now() + 60000, impersonating: 'victim@test.com' });
    const req = { headers: { cookie: 'session=sess456' } };
    // Non-admin with impersonating flag should still return their own email
    expect(await getEffectiveEmail(req)).toBe('test@test.com');
  });

  test('getEffectiveEmail returns null for expired session', async () => {
    tokenStore.set('expired', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() - 1000 });
    const req = { headers: { cookie: 'session=expired' } };
    expect(await getEffectiveEmail(req)).toBe(null);
  });

  test('getEffectiveEmail returns null for missing cookie', async () => {
    const req = { headers: { cookie: '' } };
    expect(await getEffectiveEmail(req)).toBe(null);
  });

  test('getEffectiveEmail supports bearer token sessions', async () => {
    tokenStore.set('bearer-sess', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000, impersonating: 'client@test.com' });
    const req = { headers: { authorization: 'Bearer bearer-sess' } };
    expect(await getEffectiveEmail(req)).toBe('client@test.com');
  });

  test('requireAuth uses effective impersonated email', async () => {
    tokenStore.set('imp-1', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000, impersonating: 'client@test.com' });
    const req = { headers: { cookie: 'session=imp-1' } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { return this; }
    };
    const email = await requireAuth(req, res);
    expect(email).toBe('client@test.com');
    expect(req.userEmail).toBe('client@test.com');
  });
});

describe('Session token extraction', () => {
  test('extracts session token from cookie', () => {
    const req = { headers: { cookie: 'session=abc123; theme=dark' } };
    expect(getSessionTokenFromRequest(req)).toBe('abc123');
  });

  test('extracts session token from Authorization header', () => {
    const req = { headers: { authorization: 'Bearer tok-123' } };
    expect(getSessionTokenFromRequest(req)).toBe('tok-123');
  });

  test('extracts session token from request body', () => {
    const req = { headers: {}, body: { sessionToken: 'body-123' } };
    expect(getSessionTokenFromRequest(req)).toBe('body-123');
  });
});

describe('Impersonation handler', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  test('accepts bearer session token when starting impersonation', async () => {
    const handler = require('../api-local/admin/impersonate.js');
    tokenStore.set('bearer-admin', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000 });
    const req = {
      path: '/impersonate',
      headers: { authorization: 'Bearer bearer-admin' },
      body: { email: 'client@test.com' }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    const updated = await tokenStore.get('bearer-admin');
    expect(updated.impersonating).toBe('client@test.com');
  });
});

// ─── Secrets Encryption ───

describe('Secrets Encryption', () => {
  // Import the encrypt/decrypt functions directly
  const crypto = require('crypto');
  // Explicitly set test encryption key
  const TEST_KEY = 'test-encryption-key-for-unit-tests';
  const ENCRYPTION_KEY = crypto.scryptSync(
    TEST_KEY,
    'clawops-secrets-salt',
    32
  );

  function encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  }

  function decrypt(ciphertext) {
    const [ivHex, tagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  function maskValue(value) {
    if (!value || value.length < 8) return '••••••••';
    return value.slice(0, 4) + '••••' + value.slice(-4);
  }

  test('encrypts and decrypts correctly', async () => {
    const original = 'sk-ant-api03-test1234567890';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('different encryptions produce different ciphertext (random IV)', async () => {
    const original = 'same-key-same-value';
    const e1 = encrypt(original);
    const e2 = encrypt(original);
    expect(e1).not.toBe(e2); // Different IVs
    expect(decrypt(e1)).toBe(original);
    expect(decrypt(e2)).toBe(original);
  });

  test('ciphertext format is iv:tag:encrypted', async () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(32); // 16 bytes IV = 32 hex
    expect(parts[1].length).toBe(32); // 16 bytes tag = 32 hex
    expect(parts[2].length > 0).toBeTruthy(); // encrypted data
  });

  test('tampered ciphertext throws', async () => {
    const encrypted = encrypt('secret-value');
    const parts = encrypted.split(':');
    // Tamper with the encrypted data
    parts[2] = 'ff' + parts[2].slice(2);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  test('masks short values', async () => {
    expect(maskValue('short')).toBe('••••••••');
    expect(maskValue('')).toBe('••••••••');
    expect(maskValue(null)).toBe('••••••••');
  });

  test('masks long values showing first4 and last4', async () => {
    expect(maskValue('sk-ant-api03-test1234')).toBe('sk-a••••1234');
    expect(maskValue('fal-test-key-abcdef')).toBe('fal-••••cdef');
  });

  test('handles unicode in secret values', async () => {
    const original = 'key-with-émojis-🔐-and-ñ';
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });
});

// ─── Chat Proxy Auth ───

describe('Chat Proxy Auth', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  test('valid session returns email', async () => {
    tokenStore.set('good', { type: 'session', email: 'user@test.com', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=good' } };
    expect(await getEmailFromSession(req)).toBe('user@test.com');
  });

  test('wrong type token rejected', async () => {
    tokenStore.set('magic', { type: 'magic-link', email: 'user@test.com', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=magic' } };
    expect(await getEmailFromSession(req)).toBe(null);
  });

  test('expired session rejected', async () => {
    tokenStore.set('old', { type: 'session', email: 'user@test.com', expiresAt: Date.now() - 1 });
    const req = { headers: { cookie: 'session=old' } };
    expect(await getEmailFromSession(req)).toBe(null);
  });

  test('no cookie returns null', async () => {
    expect(await getEmailFromSession({ headers: { cookie: '' } })).toBe(null);
    expect(await getEmailFromSession({ headers: {} })).toBe(null);
  });

  test('Bearer token auth works', async () => {
    tokenStore.set('bearer123', { type: 'session', email: 'api@test.com', expiresAt: Date.now() + 60000 });
    // getEmailFromSession only checks cookies, not Bearer — that's in chat proxy
    // Bearer token auth now supported as fallback
    const req = { headers: { cookie: '', authorization: 'Bearer bearer123' } };
    expect(await getEmailFromSession(req)).toBe('api@test.com'); // Bearer fallback
  });
});
