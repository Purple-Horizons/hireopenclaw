/**
 * Server-side Chat Proxy for OpenClaw bot instances
 * 
 * Gateway tokens NEVER leave the server.
 * Client authenticates via dashboard session cookie.
 * Server connects to bot's OpenClaw WS using proper protocol.
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const { DynamoDBClient, GetItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const tokenStore = require('../auth/token-store.js');

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
  }
});

// Connection pool: botId -> { ws, connected, queue, lastActivity }
const connectionPool = new Map();

const PROTOCOL_VERSION = 3;
const CONNECT_TIMEOUT_MS = 10000;
const IDLE_TIMEOUT_MS = 300000; // 5 min idle → disconnect

// ─── Auth helpers ───

function getSessionToken(req) {
  // Check cookie
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  if (match) return match[1];
  // Check Authorization header
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function validateSession(sessionToken) {
  if (!sessionToken) return null;
  const session = tokenStore.get(sessionToken);
  if (!session) return null;
  if (session.type !== 'session') return null;
  if (session.expiresAt < Date.now()) return null;
  return session.email;
}

async function getBotForUser(botId, email) {
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: 'clawops-tenants',
      Key: { tenantId: { S: botId } }
    }));
    if (!result.Item) return null;
    const bot = unmarshall(result.Item);
    // Verify ownership
    if (bot.email !== email) return null;
    if (bot.status === 'terminated') return null;
    return bot;
  } catch (err) {
    console.error('[Chat Proxy] DB error:', err.message);
    return null;
  }
}

// ─── OpenClaw WS Connection ───

function createConnectFrame(token) {
  return JSON.stringify({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'connect',
    params: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: 'webchat',
        displayName: 'HireOpenClaw Chat',
        version: '1.0.0',
        platform: 'web',
        mode: 'webchat'
      },
      role: 'operator',
      scopes: ['operator.admin'],
      auth: { token }
    }
  });
}

function createChatSendFrame(sessionKey, message) {
  return JSON.stringify({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'chat.send',
    params: {
      sessionKey: sessionKey || 'main',
      message,
      idempotencyKey: crypto.randomUUID()
    }
  });
}

function createChatHistoryFrame(sessionKey) {
  return JSON.stringify({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'chat.history',
    params: {
      sessionKey: sessionKey || 'main'
    }
  });
}

async function getOrCreateConnection(botId, endpoint, gatewayToken) {
  let conn = connectionPool.get(botId);
  
  if (conn && conn.ws.readyState === WebSocket.OPEN && conn.connected) {
    conn.lastActivity = Date.now();
    return conn;
  }
  
  // Clean up stale connection
  if (conn) {
    try { conn.ws.close(); } catch {}
    connectionPool.delete(botId);
  }

  return new Promise((resolve, reject) => {
    const wsUrl = endpoint.replace('http://', 'ws://').replace('https://', 'wss://');
    // Set origin to bot's own host to pass origin check
    const ws = new WebSocket(wsUrl, { origin: endpoint, headers: { 'Origin': endpoint } });
    const conn = {
      ws,
      connected: false,
      listeners: new Map(), // reqId -> callback
      eventListeners: new Set(), // SSE response objects
      lastActivity: Date.now()
    };

    const timeout = setTimeout(() => {
      if (!conn.connected) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(createConnectFrame(gatewayToken));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Handle connect response (hello-ok)
        if (!conn.connected && msg.type === 'res' && msg.ok !== false) {
          conn.connected = true;
          clearTimeout(timeout);
          connectionPool.set(botId, conn);
          console.log(`[Chat Proxy] Connected to bot ${botId}`);
          resolve(conn);
          return;
        }

        // Handle connect failure
        if (!conn.connected && msg.type === 'res' && msg.ok === false) {
          clearTimeout(timeout);
          console.error(`[Chat Proxy] Auth failed for ${botId}:`, msg.error);
          ws.close();
          reject(new Error('Bot auth failed: ' + (msg.error?.message || 'unknown')));
          return;
        }

        // Handle response to a specific request
        if (msg.type === 'res' && msg.id && conn.listeners.has(msg.id)) {
          const cb = conn.listeners.get(msg.id);
          conn.listeners.delete(msg.id);
          cb(msg);
          return;
        }

        // Forward ALL messages to SSE listeners (events, deltas, finals)
        for (const sse of conn.eventListeners) {
          try {
            sse.write(`data: ${JSON.stringify(msg)}\n\n`);
          } catch {}
        }

      } catch (err) {
        // Non-JSON or parse error
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Chat Proxy] Disconnected from bot ${botId}: ${code} ${reason}`);
      conn.connected = false;
      connectionPool.delete(botId);
      // Notify SSE listeners
      for (const sse of conn.eventListeners) {
        try {
          sse.write(`data: ${JSON.stringify({ type: 'disconnected', code })}\n\n`);
          sse.end();
        } catch {}
      }
      conn.eventListeners.clear();
    });

    ws.on('error', (err) => {
      console.error(`[Chat Proxy] WS error for ${botId}:`, err.message);
      if (!conn.connected) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function sendRequest(conn, frame) {
  return new Promise((resolve, reject) => {
    const parsed = JSON.parse(frame);
    const timeout = setTimeout(() => {
      conn.listeners.delete(parsed.id);
      reject(new Error('Request timeout'));
    }, 60000);
    
    conn.listeners.set(parsed.id, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    
    conn.ws.send(frame);
  });
}

// ─── HTTP Handlers ───

// POST /api/chat/:botId/send — Send a message, get response
async function handleSend(req, res) {
  const { botId } = req.params;

  // Auth FIRST — before any input validation
  const token = getSessionToken(req);
  const email = validateSession(token);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message, sessionKey } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  // Bot ownership
  const bot = await getBotForUser(botId, email);
  if (!bot) {
    return res.status(403).json({ error: 'Bot not found or access denied' });
  }

  if (!bot.endpoint || !bot.gatewayToken) {
    return res.status(503).json({ error: 'Bot not ready' });
  }

  try {
    const conn = await getOrCreateConnection(botId, bot.endpoint, bot.gatewayToken);
    const frame = createChatSendFrame(sessionKey || 'main', message);
    const response = await sendRequest(conn, frame);
    
    return res.status(200).json({
      ok: response.ok !== false,
      result: response.result,
      error: response.error
    });
  } catch (err) {
    console.error(`[Chat Proxy] Send error for ${botId}:`, err.message);
    return res.status(500).json({ error: 'Failed to send message: ' + err.message });
  }
}

// GET /api/chat/:botId/events — SSE stream for real-time bot events
async function handleEvents(req, res) {
  const { botId } = req.params;
  
  // Auth
  const token = getSessionToken(req);
  const email = validateSession(token);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Bot ownership
  const bot = await getBotForUser(botId, email);
  if (!bot) {
    return res.status(403).json({ error: 'Bot not found or access denied' });
  }

  if (!bot.endpoint || !bot.gatewayToken) {
    return res.status(503).json({ error: 'Bot not ready' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ type: 'connecting' })}\n\n`);

  try {
    const conn = await getOrCreateConnection(botId, bot.endpoint, bot.gatewayToken);
    conn.eventListeners.add(res);
    
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Clean up on disconnect
    req.on('close', () => {
      conn.eventListeners.delete(res);
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
}

// GET /api/chat/:botId/history — Get chat history
async function handleHistory(req, res) {
  const { botId } = req.params;
  
  // Auth
  const token = getSessionToken(req);
  const email = validateSession(token);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const bot = await getBotForUser(botId, email);
  if (!bot) {
    return res.status(403).json({ error: 'Bot not found or access denied' });
  }

  if (!bot.endpoint || !bot.gatewayToken) {
    return res.status(503).json({ error: 'Bot not ready' });
  }

  try {
    const conn = await getOrCreateConnection(botId, bot.endpoint, bot.gatewayToken);
    const frame = createChatHistoryFrame(req.query.sessionKey || 'main');
    const response = await sendRequest(conn, frame);
    
    return res.status(200).json({
      ok: response.ok !== false,
      messages: response.result?.messages || [],
      error: response.error
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get history: ' + err.message });
  }
}

// Cleanup idle connections periodically
setInterval(() => {
  const now = Date.now();
  for (const [botId, conn] of connectionPool) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      console.log(`[Chat Proxy] Closing idle connection for ${botId}`);
      try { conn.ws.close(); } catch {}
      connectionPool.delete(botId);
    }
  }
}, 60000);

module.exports = { handleSend, handleEvents, handleHistory };
