const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }

  try {
    // Send notification email via Resend
    await resend.emails.send({
      from: 'HireOpenClaw <notifications@hireopenclaw.com>',
      to: 'g@purplehorizons.io',
      subject: `🔥 New Lead: ${name}`,
      html: `
        <h2>New Signup Lead</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <hr>
        <p><em>Lead captured at Step 1. They may continue to onboarding.</em></p>
      `
    });
  } catch (emailErr) {
    // Log but don't fail — we still want to redirect
    console.error('Resend email error:', emailErr);
  }

  return res.status(200).json({ ok: true });
};
