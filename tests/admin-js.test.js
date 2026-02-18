/**
 * Tests for admin.js integrity — prevent regressions like stray HTML tags
 */
const fs = require('fs');
const path = require('path');

describe('admin.js file integrity', () => {
  const adminJsPath = path.join(__dirname, '..', 'js', 'admin.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(adminJsPath, 'utf8');
  });

  test('admin.js exists', () => {
    expect(fs.existsSync(adminJsPath)).toBe(true);
  });

  test('no stray HTML tags in JS file', () => {
    expect(content).not.toMatch(/<\/script>/i);
    expect(content).not.toMatch(/<\/body>/i);
    expect(content).not.toMatch(/<\/html>/i);
    expect(content).not.toMatch(/<script/i);
  });

  test('authFetch helper is defined', () => {
    expect(content).toContain('function authFetch(');
  });

  test('authHeaders helper is defined', () => {
    expect(content).toContain('function authHeaders(');
  });

  test('uses correct localStorage key', () => {
    expect(content).toContain("clawops_session_token");
    expect(content).not.toMatch(/localStorage\.getItem\(['"]sessionToken['"]\)/);
  });

  test('all fetch calls use authFetch', () => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip the authFetch definition itself
      if (line.includes('return fetch(url')) continue;
      // No raw fetch() calls
      if (line.includes('fetch(') && line.includes('await')) {
        expect(line).toContain('authFetch(');
      }
    }
  });

  test('loadClients function exists', () => {
    expect(content).toContain('async function loadClients()');
  });

  test('no JavaScript dialogs (alert/confirm/prompt)', () => {
    // Skip string literals and comments
    const noComments = content.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/\balert\s*\(/);
    expect(noComments).not.toMatch(/\bconfirm\s*\(/);
    expect(noComments).not.toMatch(/\bprompt\s*\(/);
  });
});

describe('dashboard-tabs.js integrity', () => {
  const tabsPath = path.join(__dirname, '..', 'dashboard-tabs.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(tabsPath, 'utf8');
  });

  test('uses correct localStorage key', () => {
    expect(content).toContain("clawops_session_token");
    expect(content).not.toMatch(/localStorage\.getItem\(['"]sessionToken['"]\)/);
  });

  test('authHeaders helper is defined', () => {
    expect(content).toContain('function authHeaders(');
  });

  test('no JavaScript dialogs', () => {
    const noComments = content.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/\balert\s*\(/);
    // confirm is OK in function names like showConfirmDialog
    expect(noComments).not.toMatch(/[^w]confirm\s*\(/); // window.confirm
    expect(noComments).not.toMatch(/\bprompt\s*\(/);
  });
});

describe('admin.html integrity', () => {
  const htmlPath = path.join(__dirname, '..', 'admin.html');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(htmlPath, 'utf8');
  });

  test('references admin.js', () => {
    expect(content).toMatch(/admin\.js/);
  });

  test('has client-side auth check', () => {
    expect(content).toContain('clawops_session_token');
  });
});
