module.exports = async (req, res) => {
  const { setCors } = require('./_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone } = req.body || {};

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }

  console.log(`[Signup] New lead: ${name} | ${email} | ${phone} | ${new Date().toISOString()}`);

  const safeName = escapeHtml(String(name));
  const safeEmail = escapeHtml(String(email));
  const safePhone = escapeHtml(String(phone));

  // Try to send notification email via Resend (non-blocking)
  if (process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: 'g@purplehorizons.io',
          subject: `🔥 New Lead: ${safeName}`,
          html: `<h2>New Signup Lead</h2>
            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Email:</strong> ${safeEmail}</p>
            <p><strong>Phone:</strong> ${safePhone}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            <hr>
            <p><em>Lead captured at Step 1. They may continue to onboarding.</em></p>`
        })
      });
    } catch (err) {
      console.error('[Signup] Email notification failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true });
};

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
