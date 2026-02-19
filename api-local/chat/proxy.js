/**
 * Server-side Chat Proxy for OpenClaw bot instances
 * 
 * Uses the HTTP /v1/chat/completions endpoint (OpenAI-compatible).
 * Gateway tokens NEVER leave the server.
 * Client authenticates via dashboard session cookie.
 * 
 * Why HTTP instead of WS:
 * OpenClaw WS strips all scopes for connections without device identity,
 * making chat.send fail. The HTTP endpoint bypasses this entirely.
 */

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const tokenStore = require('../auth/token-store.js');
const { GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { client: dynamodb, TABLES } = require('../util/dynamodb.js');
const { getTeamByOwner } = require('../auth/team-plan.js');
const { PLAN_TOKEN_LIMITS } = require('../data/plans.js');
const { normalizeUsagePolicy } = require('../billing/team-billing.js');

// In-memory conversation history per bot (ephemeral — lost on portal restart)
// botId -> { messages: [{role, content}], lastActivity }
const conversationStore = new Map();
const MAX_HISTORY = 50;
const HISTORY_TTL_MS = 3600000; // 1 hour
const USAGE_CACHE_TTL_MS = 60 * 1000; // 1 minute
const usageCache = new Map();

// ─── Auth helpers ───

function getSessionToken(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/session=([^;]+)/);
  if (match) return match[1];
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function validateSession(sessionToken) {
  if (!sessionToken) return null;
  const session = await tokenStore.get(sessionToken);
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
    if (bot.email !== email) return null;
    if (bot.status === 'terminated') return null;
    return bot;
  } catch (err) {
    console.error('[Chat Proxy] DB error:', err.message);
    return null;
  }
}

function getConversation(botId) {
  let conv = conversationStore.get(botId);
  if (!conv || Date.now() - conv.lastActivity > HISTORY_TTL_MS) {
    conv = { messages: [], lastActivity: Date.now() };
    conversationStore.set(botId, conv);
  }
  conv.lastActivity = Date.now();
  return conv;
}

// ─── HTTP Handlers ───

// POST /api/chat/:botId/send — Send message, get streaming or non-streaming response
async function handleSend(req, res) {
  const { botId } = req.params;

  const token = getSessionToken(req);
  const email = await validateSession(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const bot = await getBotForUser(botId, email);
  if (!bot) return res.status(403).json({ error: 'Bot not found or access denied' });
  if (!bot.endpoint || !bot.gatewayToken) return res.status(503).json({ error: 'Bot not ready' });

  const usageGate = await checkUsageGate(email);
  if (!usageGate.allowed) {
    return res.status(402).json({
      error: 'Monthly usage limit reached',
      code: 'USAGE_LIMIT_REACHED',
      usage: usageGate,
      message: 'Upgrade your plan or wait for the next billing cycle to continue.',
    });
  }

  // Build conversation context
  const conv = getConversation(botId);
  conv.messages.push({ role: 'user', content: message });
  if (conv.messages.length > MAX_HISTORY) {
    conv.messages = conv.messages.slice(-MAX_HISTORY);
  }

  const stream = req.query.stream === 'true' || req.body.stream === true;

  try {
    const url = `${bot.endpoint}/v1/chat/completions`;
    const body = {
      messages: conv.messages,
      stream
    };

    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bot.gatewayToken}`
      },
      body: JSON.stringify(body)
    });

    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      console.error(`[Chat Proxy] Bot ${botId} returned ${fetchRes.status}: ${errText}`);
      return res.status(fetchRes.status).json({ error: `Bot error: ${fetchRes.status}` });
    }

    if (stream) {
      // SSE streaming mode
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      let fullContent = '';
      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) fullContent += delta;
            // Forward the chunk as-is
            res.write(`data: ${data}\n\n`);
          } catch (err) { console.error('[ChatProxy] JSON parse failed:', err.message); }
        }
      }

      // Store assistant response in conversation
      if (fullContent) {
        conv.messages.push({ role: 'assistant', content: fullContent });
      }
      res.end();
    } else {
      // Non-streaming mode
      const data = await fetchRes.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Store assistant response
      if (content) {
        conv.messages.push({ role: 'assistant', content });
      }

      return res.status(200).json({
        ok: true,
        content,
        usage: data.usage
      });
    }
  } catch (err) {
    console.error(`[Chat Proxy] Send error for ${botId}:`, err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}

// GET /api/chat/:botId/events — SSE keepalive (for future real-time events)
async function handleEvents(req, res) {
  const { botId } = req.params;
  
  const token = getSessionToken(req);
  const email = await validateSession(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const bot = await getBotForUser(botId, email);
  if (!bot) return res.status(403).json({ error: 'Bot not found or access denied' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const keepalive = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 30000);

  req.on('close', () => clearInterval(keepalive));
}

// GET /api/chat/:botId/history — Get conversation history (from memory)
async function handleHistory(req, res) {
  const { botId } = req.params;
  
  const token = getSessionToken(req);
  const email = await validateSession(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const bot = await getBotForUser(botId, email);
  if (!bot) return res.status(403).json({ error: 'Bot not found or access denied' });

  const conv = getConversation(botId);
  return res.status(200).json({
    ok: true,
    messages: conv.messages
  });
}

// POST /api/chat/:botId/clear — Clear conversation history
async function handleClear(req, res) {
  const { botId } = req.params;
  
  const token = getSessionToken(req);
  const email = await validateSession(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const bot = await getBotForUser(botId, email);
  if (!bot) return res.status(403).json({ error: 'Bot not found or access denied' });

  conversationStore.delete(botId);
  return res.status(200).json({ ok: true });
}

// Cleanup stale conversations
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [botId, conv] of conversationStore) {
    if (now - conv.lastActivity > HISTORY_TTL_MS) {
      conversationStore.delete(botId);
    }
  }
}, 300000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

module.exports = { handleSend, handleEvents, handleHistory, handleClear };

async function checkUsageGate(email) {
  if (process.env.NODE_ENV === 'test') {
    return {
      allowed: true,
      policyMode: 'notify_only',
      plan: 'starter',
      tokensLimit: null,
      tokensUsed: 0,
      tokensRemaining: null,
    };
  }

  const team = await getTeamByOwner(email);
  const plan = team?.plan || 'starter';
  const rawLimit = PLAN_TOKEN_LIMITS[plan];
  const limit = Number.isFinite(rawLimit) ? rawLimit : null;
  const usagePolicy = normalizeUsagePolicy(team?.usagePolicy);
  const policyMode = usagePolicy.mode;

  if (!limit) {
    return {
      allowed: true,
      policyMode,
      plan,
      tokensLimit: null,
      tokensUsed: 0,
    };
  }

  if (policyMode !== 'hard_cap') {
    return {
      allowed: true,
      policyMode,
      plan,
      tokensLimit: limit,
      tokensUsed: null,
      tokensRemaining: null,
    };
  }

  const tokensUsed = await getMonthlyTokenUsage(email);
  const tokensRemaining = Math.max(0, limit - tokensUsed);

  if (policyMode === 'hard_cap' && tokensUsed >= limit) {
    return {
      allowed: false,
      policyMode,
      plan,
      tokensLimit: limit,
      tokensUsed,
      tokensRemaining: 0,
    };
  }

  return {
    allowed: true,
    policyMode,
    plan,
    tokensLimit: limit,
    tokensUsed,
    tokensRemaining,
  };
}

async function getMonthlyTokenUsage(email) {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const cacheKey = `${email}:${monthKey}`;
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tokensUsed;
  }

  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const tenantsResult = await dynamodb.send(makeQueryCommand({
    TableName: TABLES.TENANTS || TABLES.tenants || 'clawops-tenants',
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } },
  }));

  const tenants = (tenantsResult.Items || []).map((raw) => unmarshall(raw));
  let tokensUsed = 0;

  for (const tenant of tenants) {
    if (!tenant.tenantId) continue;
    const usageResult = await dynamodb.send(makeQueryCommand({
      TableName: TABLES.USAGE || TABLES.usage || 'clawops-usage',
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: { ':tid': { S: tenant.tenantId } },
    }));

    for (const raw of (usageResult.Items || [])) {
      const record = unmarshall(raw);
      const recordMs = getRecordTimeMs(record);
      if (recordMs !== null && recordMs < monthStartMs) continue;
      const input = parseNumber(
        record.inputTokens,
        record.tokensIn,
        record.tokenIn,
        record.promptTokens,
        record.prompt_tokens,
        record.inputTokenCount,
        record.totalInputTokens,
        record.tokens_input
      ) || 0;
      const output = parseNumber(
        record.outputTokens,
        record.tokensOut,
        record.tokenOut,
        record.completionTokens,
        record.completion_tokens,
        record.outputTokenCount,
        record.totalOutputTokens,
        record.tokens_output
      ) || 0;
      tokensUsed += input + output;
    }
  }

  usageCache.set(cacheKey, {
    tokensUsed,
    expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
  });

  return tokensUsed;
}

function parseNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function getRecordTimeMs(record) {
  const timestamp = parseNumber(record.timestamp);
  if (timestamp !== null) return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;

  for (const field of [record.date, record.lastUpdated, record.updatedAt, record.createdAt]) {
    if (!field) continue;
    const numericField = parseNumber(field);
    if (numericField !== null) return numericField > 1_000_000_000_000 ? numericField : numericField * 1000;
    const parsed = Date.parse(field);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function makeQueryCommand(params) {
  return typeof QueryCommand === 'function'
    ? new QueryCommand(params)
    : params;
}
