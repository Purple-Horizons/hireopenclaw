#!/usr/bin/env node
/**
 * HireOpenClaw Local Development Server
 * Serves static files + proxies API calls to LocalStack
 */

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { validateEnv } = require(path.join(__dirname, 'api-local', 'util', 'env-check.js'));

// Validate environment on startup
validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CSRF protection
const { validateCsrf, generateCsrfToken } = require(path.join(__dirname, 'api-local', 'auth', 'csrf.js'));

// CORS — explicit allowed origins only
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:18790',
  process.env.PORTAL_URL,
].filter(Boolean));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CLI-Secret, X-CSRF-Token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  // No caching in dev
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// CSRF validation middleware for state-changing requests
app.use(validateCsrf);

// CSRF token endpoint
app.get('/api/auth/csrf', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  const sessionToken = match ? match[1] : null;
  if (!sessionToken) return res.status(401).json({ error: 'No session' });
  const tokenStore = require(path.join(__dirname, 'api-local', 'auth', 'token-store.js'));
  const session = tokenStore.get(sessionToken);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  const csrfToken = generateCsrfToken(sessionToken);
  res.json({ csrfToken });
});

// ─── Express Router modules ───
app.use('/api/auth', require(path.join(__dirname, 'api-local', 'routes', 'auth.js')));
app.use('/api/admin', require(path.join(__dirname, 'api-local', 'routes', 'admin.js')));
app.use('/api/dashboard', require(path.join(__dirname, 'api-local', 'routes', 'dashboard.js')));
app.use('/api/settings', require(path.join(__dirname, 'api-local', 'routes', 'settings.js')));
app.use('/api/billing', require(path.join(__dirname, 'api-local', 'routes', 'billing.js')));
console.log('✓ Loaded Express Router modules (auth, admin, dashboard, settings, billing)');

// Remaining individual routes (signup, team, keys, analytics)
const remainingRoutes = [
  'signup',
  'team/create',
  'team/invite',
  'team/members',
  'team/remove',
  'keys/create',
  'keys/list',
  'keys/revoke',
  'analytics/overview',
  'analytics/timeseries',
  'analytics/compare',
];

remainingRoutes.forEach(route => {
  const routePath = `/api/${route}`;
  const handlerPath = path.join(__dirname, 'api-local', `${route}.js`);
  
  try {
    const handler = require(handlerPath);
    app.all(routePath, async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        console.error(`[API Error] ${routePath}:`, err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    console.log(`✓ Loaded ${routePath}`);
  } catch (err) {
    console.warn(`✗ Failed to load ${routePath}: ${err.message}`);
  }
});

// Public API v1 routes (rate-limited, API key auth)
try {
  const rateLimit = require(path.join(__dirname, 'middleware', 'rateLimit.js'));
  const v1Routes = [
    { method: 'get', path: '/v1/bots', handler: 'bots/list' },
    { method: 'post', path: '/v1/bots', handler: 'bots/create' },
    { method: 'delete', path: '/v1/bots/:id', handler: 'bots/delete' },
    { method: 'get', path: '/v1/usage', handler: 'usage/overview' }
  ];

  v1Routes.forEach(route => {
    const handlerPath = path.join(__dirname, 'api-v1', `${route.handler}.js`);
    try {
      const handler = require(handlerPath);
      app[route.method](route.path, rateLimit, async (req, res) => {
        try {
          await handler(req, res);
        } catch (err) {
          console.error(`[API v1 Error] ${route.path}:`, err);
          res.status(500).json({ error: 'Internal server error' });
        }
      });
      console.log(`✓ Loaded v1: ${route.method.toUpperCase()} ${route.path}`);
    } catch (err) {
      console.warn(`✗ v1 route ${route.path}: ${err.message}`);
    }
  });
} catch (err) {
  console.warn('✗ Rate limit middleware not loaded:', err.message);
}

// Chat proxy routes
try {
  const chatProxy = require(path.join(__dirname, 'api-local', 'chat', 'proxy.js'));
  app.post('/api/chat/:botId/send', async (req, res) => {
    try { await chatProxy.handleSend(req, res); }
    catch (err) { console.error('[Chat Proxy Error]', err); res.status(500).json({ error: 'Internal error' }); }
  });
  app.get('/api/chat/:botId/events', async (req, res) => {
    try { await chatProxy.handleEvents(req, res); }
    catch (err) { console.error('[Chat Events Error]', err); res.status(500).json({ error: 'Internal error' }); }
  });
  app.get('/api/chat/:botId/history', async (req, res) => {
    try { await chatProxy.handleHistory(req, res); }
    catch (err) { console.error('[Chat History Error]', err); res.status(500).json({ error: 'Internal error' }); }
  });
  app.post('/api/chat/:botId/clear', async (req, res) => {
    try { await chatProxy.handleClear(req, res); }
    catch (err) { console.error('[Chat Clear Error]', err); res.status(500).json({ error: 'Internal error' }); }
  });
  console.log('✓ Loaded chat proxy routes');
} catch (err) {
  console.warn('✗ Chat proxy not loaded:', err.message);
}

// Admin & settings routes now loaded via Express Router modules above

// Auth verify route — handles magic link callback
app.get('/auth/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('<h1>Invalid link</h1><p>No token provided.</p>');
  }
  // Call the magic-link handler in verify mode
  try {
    const handler = require(path.join(__dirname, 'api-local', 'auth', 'magic-link.js'));
    // Fake the query to trigger verify action
    req.query.action = 'verify';
    req.method = 'GET';
    
    // Intercept the JSON response to redirect instead
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (data.ok && data.sessionToken) {
        // Redirect to dashboard with session in hash fragment (picked up by JS)
        res.cookie('session', data.sessionToken, { 
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000,
          path: '/',
        });
        return res.redirect(`/dashboard#session=${data.sessionToken}&email=${encodeURIComponent(data.email)}`);
      } else {
        return res.status(401).send(`<h1>Login failed</h1><p>${data.error || 'Invalid or expired link.'}</p><p><a href="/">Try again</a></p>`);
      }
    };
    await handler(req, res);
  } catch (err) {
    console.error('[Auth Verify Error]', err);
    res.status(500).send('<h1>Something went wrong</h1><p><a href="/">Try again</a></p>');
  }
});

// Dashboard auth gate — must have session cookie
app.get('/dashboard', (req, res, next) => {
  const cookies = req.headers.cookie || '';
  const hasSession = cookies.includes('session=');
  if (!hasSession) {
    return res.redirect('/?login=true');
  }
  next();
});

// Admin dashboard — requires admin email
app.get('/admin', (req, res) => {
  const { getEmailFromSession, isAdmin } = require(path.join(__dirname, 'api-local', 'auth', 'middleware.js'));
  const email = getEmailFromSession(req);
  if (!email) return res.redirect('/?login=true');
  if (!isAdmin(email)) return res.status(403).send('<h1>403 Forbidden</h1><p>Admin access required.</p>');
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Static files (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname), {
  extensions: ['html']  // allows /dashboard to serve dashboard.html
}));

// Fallback: 404
app.use((req, res) => {
  res.status(404).send('<h1>404 Not Found</h1>');
});

// Global error handler (must be last middleware)
const { globalErrorHandler } = require(path.join(__dirname, 'api-local', 'util', 'error-handler.js'));
app.use(globalErrorHandler);

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  HireOpenClaw Local Dev Server');
  console.log('========================================');
  console.log('');
  console.log(`  Portal:     http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Onboarding: http://localhost:${PORT}/onboarding`);
  console.log('');
  console.log('  LocalStack:     http://localhost:4566');
  console.log('  MasterControl:  http://localhost:18790');
  console.log('');
  console.log('========================================');
  console.log('');
});
