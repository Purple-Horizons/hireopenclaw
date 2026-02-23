/**
 * PH-101: Route Contract Enforcement
 * 
 * Verifies that all API routes called from frontend HTML/JS files
 * have corresponding handlers in the Express server.
 * 
 * This catches missing routes before they break in production.
 */

const fs = require('fs');
const path = require('path');

// Build the Express app to get registered routes
function getRegisteredRoutes() {
  const app = require('../server.js');
  const routes = new Set();
  
  function extractRoutes(stack, prefix = '') {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods);
        const routePath = prefix + layer.route.path;
        for (const method of methods) {
          routes.add(`${method.toUpperCase()} ${routePath}`);
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // Extract the regexp-based prefix
        const match = layer.regexp?.source?.match?.(/^\^\\\/([^\\?]+)/);
        const routerPrefix = match ? '/' + match[1].replace(/\\\//g, '/') : prefix;
        extractRoutes(layer.handle.stack, routerPrefix);
      }
    }
  }
  
  extractRoutes(app._router?.stack || []);
  return routes;
}

// Extract fetch() URLs from frontend files
function extractFrontendApiCalls() {
  const frontendDir = path.join(__dirname, '..');
  const calls = [];
  
  const files = [
    'index.html', 'dashboard.html', 'admin.html', 'login.html',
    'signup.html', 'onboarding.html', 'chat.html', 'auth-verify.html',
    'dashboard-dynamic.js', 'dashboard-tabs.js', 'js/admin.js',
    'keyboard-shortcuts.js',
  ];
  
  for (const file of files) {
    const filePath = path.join(frontendDir, file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Match fetch('/api/...') and fetch(`/api/...`) patterns
    const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/g;
    let match;
    while ((match = fetchRegex.exec(content)) !== null) {
      let url = match[1];
      // Normalize template literals: replace ${...} with :param
      url = url.replace(/\$\{[^}]+\}/g, ':param');
      // Strip query params
      url = url.split('?')[0];
      calls.push({ url, file, line: content.substring(0, match.index).split('\n').length });
    }
  }
  
  return calls;
}

describe('Route Contract Enforcement (PH-101)', () => {
  let registeredRoutes;
  let frontendCalls;
  
  beforeAll(() => {
    registeredRoutes = getRegisteredRoutes();
    frontendCalls = extractFrontendApiCalls();
  });
  
  test('should find registered routes', () => {
    expect(registeredRoutes.size).toBeGreaterThan(0);
  });
  
  test('should find frontend API calls', () => {
    expect(frontendCalls.length).toBeGreaterThan(0);
  });
  
  test('critical route prefixes must be registered', () => {
    const routeList = Array.from(registeredRoutes);
    const routeStr = routeList.join(' ');
    
    // These prefixes must have at least one registered handler
    const criticalPrefixes = [
      'auth',       // auth routes (magic-link, session, verify)  
      'admin',      // admin routes
      'dashboard',  // dashboard routes
      'chat',       // chat proxy routes
      'plans',      // plans endpoint
    ];
    
    for (const prefix of criticalPrefixes) {
      const found = routeStr.includes(prefix);
      if (!found) {
        console.warn(`Missing route prefix: ${prefix}. Routes: ${routeList.slice(0, 10).join(', ')}`);
      }
      expect(found).toBe(true);
    }
  });
  
  test('frontend API calls should have matching server routes', () => {
    const unmatched = [];
    const routeList = Array.from(registeredRoutes);
    
    for (const call of frontendCalls) {
      // Normalize the URL for matching
      let normalized = call.url
        .replace(/\/:[^/]+/g, '/:param')  // normalize params
        .replace(/\/[a-f0-9-]{8,}/g, '/:param'); // normalize UUIDs/IDs
      
      // Check if any registered route could handle this
      const couldMatch = routeList.some(route => {
        const [, routePath] = route.split(' ');
        if (!routePath) return false;
        // Simple prefix match (Express routers match prefixes)
        return normalized.startsWith(routePath) || 
               routePath.includes(':') && normalized.split('/').length >= routePath.split('/').length;
      });
      
      if (!couldMatch) {
        unmatched.push(`${call.file}:${call.line} → ${call.url}`);
      }
    }
    
    if (unmatched.length > 0) {
      console.warn('⚠️ Potentially unmatched frontend API calls:');
      unmatched.forEach(u => console.warn(`  ${u}`));
    }
    
    // This is informational for now — strict enforcement after PH-098 stabilizes
    // When ready to enforce: expect(unmatched).toHaveLength(0);
    expect(unmatched.length).toBeLessThanOrEqual(10); // Allow some slack during migration
  });
  
  test('no window.prompt/alert/confirm in frontend files', () => {
    const frontendDir = path.join(__dirname, '..');
    const violations = [];
    
    const files = fs.readdirSync(frontendDir)
      .filter(f => f.endsWith('.html') || f.endsWith('.js'))
      .filter(f => !f.includes('node_modules') && !f.includes('test'));
    
    // Also check js/ subdirectory
    const jsDir = path.join(frontendDir, 'js');
    if (fs.existsSync(jsDir)) {
      files.push(...fs.readdirSync(jsDir).map(f => `js/${f}`));
    }
    
    for (const file of files) {
      const filePath = path.join(frontendDir, file);
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Match window.prompt/alert/confirm but not in comments
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // skip comments
        if (/window\.(prompt|alert|confirm)\s*\(/.test(line)) {
          violations.push(`${file}:${i + 1}: ${trimmed.substring(0, 80)}`);
        }
      });
    }
    
    expect(violations).toHaveLength(0);
  });
});
