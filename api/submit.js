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

    const safeName = escapeHtml(String(name));
    const safeBusiness = escapeHtml(String(business || 'Not provided'));
    const safeEmail = escapeHtml(String(email));
    const safePhone = escapeHtml(String(phone));
    const safeWebsite = escapeHtml(String(website || 'Not provided'));
    const safeNeeds = escapeHtml(String(Array.isArray(needs) ? needs.join(', ') : needs || 'Not specified'));
    const safeDetails = escapeHtml(String(details || 'Not provided'));
    const safePlatforms = escapeHtml(String(platforms || 'Not provided'));
    const safeVoiceExamples = escapeHtml(String(voiceExamples || 'Not provided'));
    const safeBrandVoice = escapeHtml(String(brandVoice || 'Not provided'));
    const safeAvoidTopics = escapeHtml(String(avoidTopics || 'Not provided'));
    const safeApprovalPref = escapeHtml(String(approvalPref || 'Not specified'));
    const safeBudget = escapeHtml(String(budget));
    const safeAnything = escapeHtml(String(anything || 'None'));
    const safeSubject = stripHeaderValue(String(business || name));
    const safeReplyTo = stripHeaderValue(String(email));

    // Format the email
    const emailHtml = `
      <h2>🎯 New HireOpenClaw Lead</h2>
      
      <h3>Contact Info</h3>
      <ul>
        <li><strong>Name:</strong> ${safeName}</li>
        <li><strong>Business:</strong> ${safeBusiness}</li>
        <li><strong>Email:</strong> ${safeEmail}</li>
        <li><strong>Phone:</strong> ${safePhone}</li>
        <li><strong>Website:</strong> ${safeWebsite}</li>
      </ul>

      <h3>What They Need</h3>
      <ul>
        <li><strong>Services:</strong> ${safeNeeds}</li>
        <li><strong>Details:</strong> ${safeDetails}</li>
      </ul>

      <h3>Brand & Voice</h3>
      <ul>
        <li><strong>Platforms:</strong> ${safePlatforms}</li>
        <li><strong>Voice Examples:</strong> ${safeVoiceExamples}</li>
        <li><strong>Brand Voice:</strong> ${safeBrandVoice}</li>
        <li><strong>Topics to Avoid:</strong> ${safeAvoidTopics}</li>
      </ul>

      <h3>Preferences</h3>
      <ul>
        <li><strong>Approval Preference:</strong> ${safeApprovalPref}</li>
        <li><strong>Budget:</strong> ${safeBudget}</li>
      </ul>

      ${anything ? `<h3>Additional Notes</h3><p>${safeAnything}</p>` : ''}

      <hr>
      <p><em>Submitted from hireopenclaw.com</em></p>
    `;

    const emailText = `
New HireOpenClaw Lead

Name: ${safeName}
Business: ${safeBusiness}
Email: ${safeEmail}
Phone: ${safePhone}
Website: ${safeWebsite}

Services Needed: ${safeNeeds}
Details: ${safeDetails}

Platforms: ${safePlatforms}
Voice Examples: ${safeVoiceExamples}
Brand Voice: ${safeBrandVoice}
Topics to Avoid: ${safeAvoidTopics}

Approval Preference: ${safeApprovalPref}
Budget: ${safeBudget}

Additional Notes: ${safeAnything}
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
        subject: `🎯 New Lead: ${safeSubject}`,
        html: emailHtml,
        text: emailText,
        reply_to: safeReplyTo
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

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHeaderValue(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}
