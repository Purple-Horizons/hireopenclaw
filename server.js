#!/usr/bin/env node
/**
 * HireOpenClaw Local Development Server
 * Serves static files + proxies API calls to LocalStack
 */

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for local development
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // No caching in dev
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// API routes (load from api-local directory)
const apiRoutes = [
  'signup',
  'auth/magic-link',
  'auth/session',
  'dashboard/bots',
  'dashboard/create-bot',
  'dashboard/bot-action',
  'dashboard/rename-bot',
  'dashboard/container-stats',
  'dashboard/billing',
  'dashboard/usage',
  'dashboard/margin',
  'settings/api-keys',
  'settings/team',
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
  'billing/checkout',
  'billing/webhook'
];

apiRoutes.forEach(route => {
  const routePath = `/api/${route}`;
  const handlerPath = path.join(__dirname, 'api-local', `${route}.js`);
  
  try {
    const handler = require(handlerPath);
    app.all(routePath, async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        console.error(`[API Error] ${routePath}:`, err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
      }
    });
    console.log(`✓ Loaded ${routePath}`);
  } catch (err) {
    console.warn(`✗ Failed to load ${routePath}: ${err.message}`);
  }
});

// Parameterized dashboard routes
app.get('/api/dashboard/usage/:tenantId', async (req, res) => {
  try {
    const handler = require(path.join(__dirname, 'api-local', 'dashboard', 'usage.js'));
    await handler(req, res);
  } catch (err) {
    console.error('[API Error] /api/dashboard/usage/:tenantId:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
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
  console.log('✓ Loaded chat proxy routes');
} catch (err) {
  console.warn('✗ Chat proxy not loaded:', err.message);
}

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
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: false,
          sameSite: 'lax'
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

// Static files (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname), {
  extensions: ['html']  // allows /dashboard to serve dashboard.html
}));

// Fallback: 404
app.use((req, res) => {
  res.status(404).send('<h1>404 Not Found</h1>');
});

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
