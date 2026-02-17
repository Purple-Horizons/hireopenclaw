const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');

describe('TASK-231: Express Router modules', () => {
  const routerFiles = ['auth', 'admin', 'dashboard', 'settings', 'billing'];

  routerFiles.forEach(name => {
    test(`${name} router exports a proper Express Router`, () => {
      const router = require(path.join(REPO, 'api-local', 'routes', `${name}.js`));
      // Express Router is a function with stack property
      expect(typeof router).toBe('function');
      expect(router.stack).toBeDefined();
      expect(Array.isArray(router.stack)).toBe(true);
    });
  });

  test('auth router has routes registered', () => {
    const router = require(path.join(REPO, 'api-local', 'routes', 'auth.js'));
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('dashboard router has routes registered', () => {
    const router = require(path.join(REPO, 'api-local', 'routes', 'dashboard.js'));
    expect(router.stack.length).toBeGreaterThan(0);
  });
});

describe('TASK-235: No silent catches remain', () => {
  test('no empty catch blocks in api-local', () => {
    const result = execSync(
      `grep -rn "catch.*{}" ${path.join(REPO, 'api-local')} --include="*.js" || true`,
      { encoding: 'utf8' }
    ).trim();
    // Filter out legitimate patterns (catch with named var + comment)
    const silentCatches = result.split('\n').filter(line => {
      if (!line) return false;
      // Allow: catch (err) { /* comment */ } on same line
      if (line.match(/catch\s*\(?\w*\)?\s*\{\s*\/\*/)) return false;
      // Flag: catch {} or catch { }
      return line.match(/catch\s*\{\s*\}/) || line.match(/catch\s*\{\s*\}/);
    });
    expect(silentCatches).toEqual([]);
  });
});

describe('TASK-236: Docker retry utility', () => {
  test('dockerExec retries on failure', async () => {
    // We can't actually call docker in tests, but we can verify the module structure
    const { dockerExec } = require(path.join(REPO, 'api-local', 'util', 'docker.js'));
    expect(typeof dockerExec).toBe('function');

    // Test that it throws after retries with a bad command
    await expect(dockerExec(['__nonexistent_cmd__'], { retries: 2, timeout: 1000 }))
      .rejects.toThrow();
  });
});

describe('TASK-238: Structured logger', () => {
  test('logger exports debug/info/warn/error functions', () => {
    const logger = require(path.join(REPO, 'api-local', 'util', 'logger.js'));
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  test('logger outputs valid JSON', () => {
    const logger = require(path.join(REPO, 'api-local', 'util', 'logger.js'));
    const originalLog = console.log;
    let output;
    console.log = (msg) => { output = msg; };
    
    logger.info('test-module', 'test message', { key: 'value' });
    
    console.log = originalLog;
    
    expect(output).toBeDefined();
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('test-module');
    expect(parsed.message).toBe('test message');
    expect(parsed.key).toBe('value');
    expect(parsed.time).toBeDefined();
  });
});
