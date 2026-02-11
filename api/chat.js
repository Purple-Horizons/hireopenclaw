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
    const systemPrompt = `You are the HireOpenClaw onboarding assistant. Your job is to have a brief, friendly conversation to understand what AI employee this client needs.

CLIENT INFO (already collected):
- Name: ${clientInfo?.name || 'Unknown'}
- Business: ${clientInfo?.business || 'Unknown'}
- Email: ${clientInfo?.email || 'Unknown'}

YOUR TASK:
Ask up to 5 questions to understand:
1. What tasks eat up most of their time?
2. What would their AI employee do on a typical day?
3. What platforms/tools they use (LinkedIn, Twitter, etc.)
4. Examples of content/voice they like (links or descriptions)
5. Anything the AI should NEVER do or say?

RULES:
- Be conversational and warm, not robotic
- One question at a time
- Keep responses SHORT (2-3 sentences max)
- Adapt based on their answers - skip irrelevant questions
- After 5 exchanges OR when you have enough info, say "Perfect! I've got everything I need." and provide a brief summary
- Use their name occasionally
- Match their energy (casual if they're casual, professional if they're formal)

When you have enough info, end with:
[COMPLETE]
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
        model: 'claude-3-5-haiku-latest',
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
