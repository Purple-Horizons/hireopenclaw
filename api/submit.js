// Vercel Serverless Function - Form Submission Handler
// Sends email via Resend

export default async function handler(req, res) {
  // CORS headers
  const { setCors } = require('./_cors'); setCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      business,
      email,
      phone,
      website,
      needs,
      details,
      platforms,
      voiceExamples,
      brandVoice,
      avoidTopics,
      approvalPref,
      budget,
      anything
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !budget) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format the email
    const emailHtml = `
      <h2>🎯 New HireOpenClaw Lead</h2>
      
      <h3>Contact Info</h3>
      <ul>
        <li><strong>Name:</strong> ${name}</li>
        <li><strong>Business:</strong> ${business || 'Not provided'}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Phone:</strong> ${phone}</li>
        <li><strong>Website:</strong> ${website || 'Not provided'}</li>
      </ul>

      <h3>What They Need</h3>
      <ul>
        <li><strong>Services:</strong> ${Array.isArray(needs) ? needs.join(', ') : needs || 'Not specified'}</li>
        <li><strong>Details:</strong> ${details || 'Not provided'}</li>
      </ul>

      <h3>Brand & Voice</h3>
      <ul>
        <li><strong>Platforms:</strong> ${platforms || 'Not provided'}</li>
        <li><strong>Voice Examples:</strong> ${voiceExamples || 'Not provided'}</li>
        <li><strong>Brand Voice:</strong> ${brandVoice || 'Not provided'}</li>
        <li><strong>Topics to Avoid:</strong> ${avoidTopics || 'Not provided'}</li>
      </ul>

      <h3>Preferences</h3>
      <ul>
        <li><strong>Approval Preference:</strong> ${approvalPref || 'Not specified'}</li>
        <li><strong>Budget:</strong> ${budget}</li>
      </ul>

      ${anything ? `<h3>Additional Notes</h3><p>${anything}</p>` : ''}

      <hr>
      <p><em>Submitted from hireopenclaw.com</em></p>
    `;

    const emailText = `
New HireOpenClaw Lead

Name: ${name}
Business: ${business || 'Not provided'}
Email: ${email}
Phone: ${phone}
Website: ${website || 'Not provided'}

Services Needed: ${Array.isArray(needs) ? needs.join(', ') : needs || 'Not specified'}
Details: ${details || 'Not provided'}

Platforms: ${platforms || 'Not provided'}
Voice Examples: ${voiceExamples || 'Not provided'}
Brand Voice: ${brandVoice || 'Not provided'}
Topics to Avoid: ${avoidTopics || 'Not provided'}

Approval Preference: ${approvalPref || 'Not specified'}
Budget: ${budget}

Additional Notes: ${anything || 'None'}
    `;

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'HireOpenClaw <leads@hireopenclaw.com>',
        to: ['g@purplehorizons.io'],
        subject: `🎯 New Lead: ${business || name}`,
        html: emailHtml,
        text: emailText,
        reply_to: email
      })
    });

    if (!resendResponse.ok) {
      const error = await resendResponse.text();
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    return res.status(200).json({ success: true, message: 'Form submitted successfully' });

  } catch (error) {
    console.error('Form submission error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
