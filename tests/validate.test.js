const {
  validateTenantId, validateBackupId, validateEmail,
  validateBotName, validatePlan, validateTemplate, validateLines
} = require('../api-local/util/validate.js');

describe('validateTenantId', () => {
  test('accepts valid tenant IDs', () => {
    expect(validateTenantId('tenant-123456-ab12')).toBe(true);
    expect(validateTenantId('my-bot-123')).toBe(true);
    expect(validateTenantId('abc')).toBe(true);
    expect(validateTenantId('a_b-c')).toBe(true);
  });

  test('rejects injection attempts', () => {
    expect(validateTenantId('foo; rm -rf /')).toBe(false);
    expect(validateTenantId('foo`whoami`')).toBe(false);
    expect(validateTenantId('foo$(cat /etc/passwd)')).toBe(false);
    expect(validateTenantId('foo|ls')).toBe(false);
    expect(validateTenantId('foo && echo pwned')).toBe(false);
    expect(validateTenantId('foo\nls')).toBe(false);
    expect(validateTenantId('../../../etc/passwd')).toBe(false);
  });

  test('rejects empty/null/short', () => {
    expect(validateTenantId('')).toBe(false);
    expect(validateTenantId(null)).toBe(false);
    expect(validateTenantId(undefined)).toBe(false);
    expect(validateTenantId('ab')).toBe(false); // too short
    expect(validateTenantId(123)).toBe(false);
  });

  test('rejects IDs starting with hyphen/underscore', () => {
    expect(validateTenantId('-bad')).toBe(false);
    expect(validateTenantId('_bad')).toBe(false);
  });
});

describe('validateBackupId', () => {
  test('accepts valid backup IDs', () => {
    expect(validateBackupId('bk-1707123456789-abcd1234')).toBe(true);
  });

  test('rejects invalid formats', () => {
    expect(validateBackupId('bk-short-abc')).toBe(false);
    expect(validateBackupId('notabackup')).toBe(false);
    expect(validateBackupId('bk-1707123456789-ABCD1234')).toBe(false); // uppercase
    expect(validateBackupId('bk-1707123456789-abcd1234; rm -rf /')).toBe(false);
    expect(validateBackupId('')).toBe(false);
    expect(validateBackupId(null)).toBe(false);
  });
});

describe('validateEmail', () => {
  test('accepts valid emails', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user.name+tag@domain.co')).toBe(true);
  });

  test('rejects injection attempts', () => {
    expect(validateEmail('test@example.com; rm -rf /')).toBe(false);
    expect(validateEmail('test@example.com`whoami`')).toBe(false);
    expect(validateEmail('')).toBe(false);
    expect(validateEmail(null)).toBe(false);
  });
});

describe('validateBotName', () => {
  test('accepts valid names', () => {
    expect(validateBotName('My Bot')).toBe(true);
    expect(validateBotName("Gianni's Helper")).toBe(true);
    expect(validateBotName('bot-123')).toBe(true);
  });

  test('rejects injection attempts', () => {
    expect(validateBotName('bot; rm -rf /')).toBe(false);
    expect(validateBotName('bot$(whoami)')).toBe(false);
    expect(validateBotName('bot`ls`')).toBe(false);
    expect(validateBotName('')).toBe(false);
    expect(validateBotName(null)).toBe(false);
  });
});

describe('validatePlan', () => {
  test('accepts valid plans', () => {
    expect(validatePlan('starter')).toBe(true);
    expect(validatePlan('pro')).toBe(true);
    expect(validatePlan(undefined)).toBe(true); // optional
  });

  test('rejects invalid plans', () => {
    expect(validatePlan('hacker')).toBe(false);
    expect(validatePlan('starter; rm -rf /')).toBe(false);
  });
});

describe('validateTemplate', () => {
  test('accepts valid templates', () => {
    expect(validateTemplate('blank')).toBe(true);
    expect(validateTemplate(undefined)).toBe(true);
  });

  test('rejects invalid', () => {
    expect(validateTemplate('evil')).toBe(false);
  });
});

describe('validateLines', () => {
  test('returns valid numbers clamped to range', () => {
    expect(validateLines('100')).toBe(100);
    expect(validateLines('1')).toBe(1);
    expect(validateLines('500')).toBe(500);
    expect(validateLines('9999')).toBe(500);
    expect(validateLines('0')).toBe(1);
    expect(validateLines('-5')).toBe(1);
  });

  test('returns default for invalid input', () => {
    expect(validateLines(undefined)).toBe(50);
    expect(validateLines('abc')).toBe(50);
    expect(validateLines('; rm -rf /')).toBe(50);
  });
});
