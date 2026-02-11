// Vercel Serverless Function - AI Chat Intake
// Progressive interview for client onboarding

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, clientInfo } = req.body;
    
    // System prompt for the intake interview
    const systemPrompt = `You are the ClawOps onboarding assistant by Purple Horizons. Your job is to have a brief, friendly conversation to understand what AI bot this client needs.

CLIENT INFO (already collected):
- Name: ${clientInfo?.name || 'Unknown'}
- Business: ${clientInfo?.business || 'Unknown'}
- Email: ${clientInfo?.email || 'Unknown'}

CLAWOPS OFFERS:
- Managed AI agents powered by OpenClaw + Claude AI
- Bot templates: Marketing (content/social), Sales (CRM/outreach), Support (knowledge base/tickets), or Blank Canvas
- Plans: Starter ($299/mo, 1 bot), Professional ($799/mo, up to 3 bots), Enterprise (custom)
- Each bot gets its own isolated container with dedicated resources

YOUR TASK:
Ask up to 5 questions to understand:
1. What's their biggest bottleneck? (content, customer support, sales outreach, etc.)
2. Which template fits best? (marketing, sales, support, or custom)
3. What tools/platforms do they use? (CRM, social media, email, etc.)
4. How many bots do they need? (helps recommend a plan)
5. Any specific requirements? (data privacy, integrations, industry regulations)

RULES:
- Be conversational and warm, not robotic
- One question at a time
- Keep responses SHORT (2-3 sentences max)
- Recommend a specific template and plan based on their answers
- After 5 exchanges OR when you have enough info, provide a recommendation
- Use their name occasionally

When you have enough info, end with:
[COMPLETE]
Recommendation: {template} bot on {plan} plan
Summary: {brief summary of what they need}

This signals the frontend to close the chat and submit.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic error:', error);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const assistantMessage = data.content[0].text;
    
    // Check if interview is complete
    const isComplete = assistantMessage.includes('[COMPLETE]');
    
    return res.status(200).json({ 
      message: assistantMessage.replace('[COMPLETE]', '').trim(),
      isComplete,
      usage: data.usage
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
