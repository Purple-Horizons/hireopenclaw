/**
 * Security Medium Priority Tests
 * TASK-210, 211, 218, 219
 */

describe('TASK-218: Rate Limiting', () => {
  let rateLimit, _reset, MAX_ATTEMPTS;

  beforeEach(() => {
    const rl = require('../api-local/auth/rate-limit.js');
    rateLimit = rl.rateLimit;
    _reset = rl._reset;
    MAX_ATTEMPTS = rl.MAX_ATTEMPTS;
    _reset();
  });

  test('allows requests up to MAX_ATTEMPTS', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(rateLimit('test-key')).toBe(true);
    }
  });

  test('blocks after MAX_ATTEMPTS', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      rateLimit('test-key');
    }
    expect(rateLimit('test-key')).toBe(false);
  });

  test('different keys are independent', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      rateLimit('key-a');
    }
    expect(rateLimit('key-a')).toBe(false);
    expect(rateLimit('key-b')).toBe(true);
  });
});

describe('TASK-211: Error Sanitization', () => {
  const fs = require('fs');
  const path = require('path');

  function findJsonResponses(dir) {
    const results = [];
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory() && f.name !== 'node_modules') {
        results.push(...findJsonResponses(full));
      } else if (f.name.endsWith('.js')) {
        const content = fs.readFileSync(full, 'utf8');
        // Check for 500 responses that leak error details
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes('500') && (line.includes('err.message') || line.includes('error.message'))) {
            results.push({ file: full, line: i + 1, text: line.trim() });
          }
          if (line.includes('details: error.message') || line.includes('details: err.message')) {
            results.push({ file: full, line: i + 1, text: line.trim() });
          }
        });
      }
    }
    return results;
  }

  test('no 500 responses leak error.message in api-local/', () => {
    const apiDir = path.join(__dirname, '..', 'api-local');
    const leaks = findJsonResponses(apiDir);
    expect(leaks).toEqual([]);
  });

  test('no 500 responses leak error.message in server.js', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const hasLeak = /status\(500\).*(?:err|error)\.message/.test(content);
    expect(hasLeak).toBe(false);
  });
});

describe('TASK-219: Security Headers', () => {
  const fs = require('fs');
  const path = require('path');

  test('server.js includes security headers middleware', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(content).toContain('X-Content-Type-Options');
    expect(content).toContain('nosniff');
    expect(content).toContain('X-Frame-Options');
    expect(content).toContain('DENY');
    expect(content).toContain('Referrer-Policy');
    expect(content).toContain('Permissions-Policy');
    expect(content).toContain('Strict-Transport-Security');
  });
});

describe('TASK-210: Dev Token Protection', () => {
  const fs = require('fs');
  const path = require('path');

  test('magic-link.js uses strict dev token check', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'api-local', 'auth', 'magic-link.js'), 'utf8'
    );
    // Must NOT have the old loose check
    expect(content).not.toContain("!process.env.NODE_ENV || process.env.NODE_ENV === 'development'");
    // Must have the strict check
    expect(content).toContain("process.env.NODE_ENV === 'development' && process.env.MAGIC_LINK_DEV_TOKENS === 'true'");
  });
});
