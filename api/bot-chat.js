/**
 * Vercel Serverless Function — Bot Chat Proxy
 * Routes: POST /api/bot-chat?botId=xxx&stream=true
 * 
 * Forwards chat messages to the ECS proxy at api.hireopenclaw.com,
 * which routes to the tenant's bot container.
 * Auth: portal session cookie forwarded to proxy for validation.
 */

export default async function handler(req, res) {
  // CORS
  const allowedOrigins = ['https://hireopenclaw.com', 'http://localhost:3000'];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { botId, stream } = req.query;
  if (!botId) return res.status(400).json({ error: 'botId required' });

  const { message, messages } = req.body || {};
  if (!message && !messages) return res.status(400).json({ error: 'message or messages required' });

  const PROXY_BASE = process.env.CLAWOPS_API_URL || 'https://api.hireopenclaw.com';

  // Build chat completions request
  const chatMessages = messages || [{ role: 'user', content: message }];
  const body = JSON.stringify({
    messages: chatMessages,
    stream: stream === 'true',
  });

  // Forward session cookie / auth header to proxy
  const headers = {
    'Content-Type': 'application/json',
  };
  if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

  const targetUrl = `${PROXY_BASE}/chat/${botId}/v1/chat/completions`;

  try {
    const proxyRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
    });

    if (!proxyRes.ok) {
      const errText = await proxyRes.text();
      console.error(`[BotChat] Proxy returned ${proxyRes.status}: ${errText}`);
      return res.status(proxyRes.status).json({ error: `Bot error: ${proxyRes.status}`, details: errText });
    }

    if (stream === 'true') {
      // SSE streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const reader = proxyRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const data = await proxyRes.json();
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error('[BotChat] Error:', err.message);
    return res.status(502).json({ error: 'Failed to reach bot', details: err.message });
  }
}
