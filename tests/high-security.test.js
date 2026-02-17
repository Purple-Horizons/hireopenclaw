const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

describe('TASK-206: CORS Configuration', () => {
  test('server.js does not use wildcard CORS', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(server).not.toMatch(/Access-Control-Allow-Origin.*\*/);
    expect(server).toContain('ALLOWED_ORIGINS');
  });

  test('Vercel API files do not use wildcard CORS', () => {
    const result = execSync(
      `grep -rl "Access-Control-Allow-Origin.*\\*" ${ROOT}/api/ 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();
    expect(result).toBe('');
  });
});

describe('TASK-207: Session Cookie Security', () => {
  test('session cookie is httpOnly', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(server).toMatch(/httpOnly:\s*true/);
  });

  test('session cookie has sameSite lax', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(server).toMatch(/sameSite:\s*['"]lax['"]/);
  });

  test('session cookie has secure flag for production', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(server).toMatch(/secure:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
  });
});

describe('TASK-209: XSS Sanitization', () => {
  test('chat.html includes DOMPurify', () => {
    const chat = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
    expect(chat).toContain('dompurify');
    expect(chat).toContain('DOMPurify.sanitize');
  });
});

describe('TASK-400: No alert/confirm/prompt', () => {
  test('no alert() calls in source files', () => {
    const result = execSync(
      `grep -rn "\\balert\\s*(" ${ROOT} --include="*.html" --include="*.js" | grep -v node_modules | grep -v ".test." | grep -v "replaces alert" | grep -v "Replaces.*alert" || true`,
      { encoding: 'utf8' }
    ).trim();
    // Filter out comments and string references
    const realAlerts = result.split('\n').filter(line => {
      if (!line) return false;
      if (line.includes('showToast')) return false;
      if (line.includes('//')) return false;
      if (line.includes('inline-confirm')) return false;
      return /\balert\s*\(/.test(line);
    });
    expect(realAlerts).toEqual([]);
  });
});
