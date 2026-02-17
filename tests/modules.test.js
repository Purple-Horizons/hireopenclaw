/**
 * Module Existence Test
 * Parses server.js for all require() calls and verifies each file exists.
 * Catches accidental deletions (like the chat proxy incident).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

describe('Module existence — all required files must exist', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // Match require() calls with path.join(__dirname, ...) pattern
  // e.g. require(path.join(__dirname, 'api-local', 'chat', 'proxy.js'))
  const pathJoinRegex = /require\(path\.join\(__dirname,\s*((?:'[^']+',?\s*)+)\)\)/g;
  const modules = [];
  let m;
  while ((m = pathJoinRegex.exec(serverSrc)) !== null) {
    const parts = m[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const relPath = path.join(...parts);
    // Deduplicate
    if (!modules.includes(relPath)) modules.push(relPath);
  }

  // Also match standalone require('./...') or require('...') for local files
  const standaloneRegex = /require\(['"](\.[^'"]+)['"]\)/g;
  while ((m = standaloneRegex.exec(serverSrc)) !== null) {
    if (!modules.includes(m[1])) modules.push(m[1]);
  }

  test('found modules to check', () => {
    expect(modules.length).toBeGreaterThan(5);
  });

  modules.forEach(mod => {
    test(`${mod} exists`, () => {
      const fullPath = path.join(ROOT, mod);
      // Try with and without .js extension
      const exists = fs.existsSync(fullPath) || fs.existsSync(fullPath + '.js');
      expect(exists).toBe(true);
    });
  });

  // Explicitly check critical modules that MUST exist
  const criticalModules = [
    'api-local/chat/proxy.js',
    'api-local/routes/auth.js',
    'api-local/routes/admin.js',
    'api-local/routes/dashboard.js',
    'api-local/routes/settings.js',
    'api-local/routes/billing.js',
    'api-local/auth/csrf.js',
    'api-local/auth/middleware.js',
    'api-local/util/env-check.js',
    'api-local/util/etag.js',
    'api-local/util/error-handler.js',
    'api-local/data/plans.js',
    'api-local/signup.js',
    'middleware/rateLimit.js',
  ];

  criticalModules.forEach(mod => {
    test(`CRITICAL: ${mod} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, mod))).toBe(true);
    });
  });
});
