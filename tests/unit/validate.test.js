const {
  validateTenantId, validateBackupId, validateEmail,
  validateBotName, validatePlan, validateTemplate, validateLines
} = require('../../api-local/util/validate');

describe('validateTenantId', () => {
  test('accepts valid IDs', () => {
    expect(validateTenantId('abc')).toBe(true);
    expect(validateTenantId('my-bot_123')).toBe(true);
    expect(validateTenantId('a'.repeat(64))).toBe(true);
  });
  test('rejects empty/null/undefined', () => {
    expect(validateTenantId('')).toBe(false);
    expect(validateTenantId(null)).toBe(false);
    expect(validateTenantId(undefined)).toBe(false);
  });
  test('rejects too short (< 3 chars)', () => {
    expect(validateTenantId('ab')).toBe(false);
  });
  test('rejects too long (> 64 chars)', () => {
    expect(validateTenantId('a'.repeat(65))).toBe(false);
  });
  test('rejects injection characters', () => {
    expect(validateTenantId('abc;rm -rf')).toBe(false);
    expect(validateTenantId('abc$(cmd)')).toBe(false);
    expect(validateTenantId('abc&echo')).toBe(false);
    expect(validateTenantId('abc|cat')).toBe(false);
  });
  test('rejects starting with hyphen/underscore', () => {
    expect(validateTenantId('-abc')).toBe(false);
    expect(validateTenantId('_abc')).toBe(false);
  });
  test('rejects non-string', () => {
    expect(validateTenantId(123)).toBe(false);
    expect(validateTenantId({})).toBe(false);
  });
});

describe('validateBackupId', () => {
  test('accepts valid backup IDs', () => {
    expect(validateBackupId('bk-1234567890123-abcdef01')).toBe(true);
  });
  test('rejects invalid formats', () => {
    expect(validateBackupId('bk-123-abc')).toBe(false);
    expect(validateBackupId('notabackup')).toBe(false);
    expect(validateBackupId('')).toBe(false);
    expect(validateBackupId(null)).toBe(false);
  });
});

describe('validateEmail', () => {
  test('accepts valid emails', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user+tag@domain.co')).toBe(true);
  });
  test('rejects invalid emails', () => {
    expect(validateEmail('notanemail')).toBe(false);
    expect(validateEmail('@domain.com')).toBe(false);
    expect(validateEmail('user@')).toBe(false);
    expect(validateEmail('')).toBe(false);
    expect(validateEmail(null)).toBe(false);
  });
  test('rejects overly long emails (> 254)', () => {
    expect(validateEmail('a'.repeat(250) + '@b.com')).toBe(false);
  });
});

describe('validateBotName', () => {
  test('accepts valid names', () => {
    expect(validateBotName('My Bot')).toBe(true);
    expect(validateBotName("O'Brien's Bot")).toBe(true);
    expect(validateBotName('bot-1')).toBe(true);
  });
  test('rejects empty/null', () => {
    expect(validateBotName('')).toBe(false);
    expect(validateBotName(null)).toBe(false);
  });
  test('rejects names > 64 chars', () => {
    expect(validateBotName('a'.repeat(65))).toBe(false);
  });
  test('rejects shell metacharacters', () => {
    expect(validateBotName('bot;rm')).toBe(false);
    expect(validateBotName('bot$(x)')).toBe(false);
  });
});

describe('validatePlan', () => {
  test('accepts valid plans', () => {
    expect(validatePlan('free')).toBe(false);
    expect(validatePlan('starter')).toBe(true);
    expect(validatePlan('pro')).toBe(true);
    expect(validatePlan('business')).toBe(true);
    expect(validatePlan('enterprise')).toBe(true);
  });
  test('accepts null/undefined (optional field)', () => {
    expect(validatePlan(null)).toBe(true);
    expect(validatePlan(undefined)).toBe(true);
  });
  test('rejects invalid plans', () => {
    expect(validatePlan('premium')).toBe(false);
    expect(validatePlan('superplan')).toBe(false);
  });
});

describe('validateTemplate', () => {
  test('accepts valid templates', () => {
    expect(validateTemplate('blank')).toBe(true);
    expect(validateTemplate('assistant')).toBe(true);
    expect(validateTemplate('content')).toBe(true);
    expect(validateTemplate('support')).toBe(true);
    expect(validateTemplate('sales')).toBe(true);
  });
  test('accepts null/undefined (optional)', () => {
    expect(validateTemplate(null)).toBe(true);
    expect(validateTemplate(undefined)).toBe(true);
  });
  test('rejects invalid templates', () => {
    expect(validateTemplate('custom')).toBe(false);
  });
});

describe('validateLines', () => {
  test('returns default 50 for NaN', () => {
    expect(validateLines('abc')).toBe(50);
    expect(validateLines(undefined)).toBe(50);
  });
  test('clamps to min 1', () => {
    expect(validateLines(0)).toBe(1);
    expect(validateLines(-5)).toBe(1);
  });
  test('clamps to max 500', () => {
    expect(validateLines(999)).toBe(500);
  });
  test('passes through valid values', () => {
    expect(validateLines(100)).toBe(100);
    expect(validateLines('200')).toBe(200);
  });
});
