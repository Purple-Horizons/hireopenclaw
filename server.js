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
  'settings/team'
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
