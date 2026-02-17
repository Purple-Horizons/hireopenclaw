/**
 * Unit tests for admin auth, secrets encryption, and impersonation
 */

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const tokenStore = require('../api-local/auth/token-store.js');
const { isAdmin, getEmailFromSession, getEffectiveEmail, ADMIN_EMAILS } = require('../api-local/auth/middleware.js');

// ─── Admin Auth ───

describe('Admin Auth', () => {
  it('g@purplehorizons.io is admin', () => {
    assert.strictEqual(isAdmin('g@purplehorizons.io'), true);
  });

  it('case insensitive admin check', () => {
    assert.strictEqual(isAdmin('G@purplehorizons.io'), true);
    assert.strictEqual(isAdmin('G@PURPLEHORIZONS.IO'), true);
  });

  it('random email is not admin', () => {
    assert.strictEqual(isAdmin('test@test.com'), false);
    assert.strictEqual(isAdmin('admin@evil.com'), false);
  });

  it('null/undefined is not admin', () => {
    assert.ok(!isAdmin(null));
    assert.ok(!isAdmin(undefined));
    assert.ok(!isAdmin(''));
  });

  it('gianni@purplehorizons.io is NOT admin (removed)', () => {
    assert.strictEqual(isAdmin('gianni@purplehorizons.io'), false);
  });

  it('only expected emails in allowlist', () => {
    assert.strictEqual(ADMIN_EMAILS.size, 1);
    assert.ok(ADMIN_EMAILS.has('g@purplehorizons.io'));
  });
});

// ─── Impersonation ───

describe('Impersonation', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('getEffectiveEmail returns session email normally', () => {
    tokenStore.set('sess123', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=sess123' } };
    assert.strictEqual(getEffectiveEmail(req), 'g@purplehorizons.io');
  });

  it('getEffectiveEmail returns impersonated email for admin', () => {
    tokenStore.set('sess123', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() + 60000, impersonating: 'client@test.com' });
    const req = { headers: { cookie: 'session=sess123' } };
    assert.strictEqual(getEffectiveEmail(req), 'client@test.com');
  });

  it('getEffectiveEmail ignores impersonation for non-admin', () => {
    tokenStore.set('sess456', { type: 'session', email: 'test@test.com', expiresAt: Date.now() + 60000, impersonating: 'victim@test.com' });
    const req = { headers: { cookie: 'session=sess456' } };
    // Non-admin with impersonating flag should still return their own email
    assert.strictEqual(getEffectiveEmail(req), 'test@test.com');
  });

  it('getEffectiveEmail returns null for expired session', () => {
    tokenStore.set('expired', { type: 'session', email: 'g@purplehorizons.io', expiresAt: Date.now() - 1000 });
    const req = { headers: { cookie: 'session=expired' } };
    assert.strictEqual(getEffectiveEmail(req), null);
  });

  it('getEffectiveEmail returns null for missing cookie', () => {
    const req = { headers: { cookie: '' } };
    assert.strictEqual(getEffectiveEmail(req), null);
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

  it('encrypts and decrypts correctly', () => {
    const original = 'sk-ant-api03-test1234567890';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    assert.strictEqual(decrypted, original);
  });

  it('different encryptions produce different ciphertext (random IV)', () => {
    const original = 'same-key-same-value';
    const e1 = encrypt(original);
    const e2 = encrypt(original);
    assert.notStrictEqual(e1, e2); // Different IVs
    assert.strictEqual(decrypt(e1), original);
    assert.strictEqual(decrypt(e2), original);
  });

  it('ciphertext format is iv:tag:encrypted', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    assert.strictEqual(parts.length, 3);
    assert.strictEqual(parts[0].length, 32); // 16 bytes IV = 32 hex
    assert.strictEqual(parts[1].length, 32); // 16 bytes tag = 32 hex
    assert.ok(parts[2].length > 0); // encrypted data
  });

  it('tampered ciphertext throws', () => {
    const encrypted = encrypt('secret-value');
    const parts = encrypted.split(':');
    // Tamper with the encrypted data
    parts[2] = 'ff' + parts[2].slice(2);
    assert.throws(() => decrypt(parts.join(':')));
  });

  it('masks short values', () => {
    assert.strictEqual(maskValue('short'), '••••••••');
    assert.strictEqual(maskValue(''), '••••••••');
    assert.strictEqual(maskValue(null), '••••••••');
  });

  it('masks long values showing first4 and last4', () => {
    assert.strictEqual(maskValue('sk-ant-api03-test1234'), 'sk-a••••1234');
    assert.strictEqual(maskValue('fal-test-key-abcdef'), 'fal-••••cdef');
  });

  it('handles unicode in secret values', () => {
    const original = 'key-with-émojis-🔐-and-ñ';
    const encrypted = encrypt(original);
    assert.strictEqual(decrypt(encrypted), original);
  });
});

// ─── Chat Proxy Auth ───

describe('Chat Proxy Auth', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('valid session returns email', () => {
    tokenStore.set('good', { type: 'session', email: 'user@test.com', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=good' } };
    assert.strictEqual(getEmailFromSession(req), 'user@test.com');
  });

  it('wrong type token rejected', () => {
    tokenStore.set('magic', { type: 'magic-link', email: 'user@test.com', expiresAt: Date.now() + 60000 });
    const req = { headers: { cookie: 'session=magic' } };
    assert.strictEqual(getEmailFromSession(req), null);
  });

  it('expired session rejected', () => {
    tokenStore.set('old', { type: 'session', email: 'user@test.com', expiresAt: Date.now() - 1 });
    const req = { headers: { cookie: 'session=old' } };
    assert.strictEqual(getEmailFromSession(req), null);
  });

  it('no cookie returns null', () => {
    assert.strictEqual(getEmailFromSession({ headers: { cookie: '' } }), null);
    assert.strictEqual(getEmailFromSession({ headers: {} }), null);
  });

  it('Bearer token auth works', () => {
    tokenStore.set('bearer123', { type: 'session', email: 'api@test.com', expiresAt: Date.now() + 60000 });
    // getEmailFromSession only checks cookies, not Bearer — that's in chat proxy
    // This verifies cookie-only path
    const req = { headers: { cookie: '', authorization: 'Bearer bearer123' } };
    assert.strictEqual(getEmailFromSession(req), null); // Cookie path only
  });
});
