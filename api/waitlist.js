export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, firstName, lastName, phone } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First and last name required' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'Mobile phone required' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

  if (!RESEND_API_KEY || !AUDIENCE_ID) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    // 0. Save full record to DynamoDB (includes phone)
    const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const dynamo = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION || 'us-east-1' });
    await dynamo.send(new PutItemCommand({
      TableName: 'clawops-waitlist',
      Item: {
        email: { S: email },
        firstName: { S: firstName },
        lastName: { S: lastName },
        phone: { S: phone },
        createdAt: { S: new Date().toISOString() },
        source: { S: 'website' }
      }
    })).catch(err => console.error('[Waitlist] DynamoDB save failed:', err.message));

    // 1. Add to audience (waitlist)
    const addRes = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        first_name: firstName,
        last_name: lastName,
        unsubscribed: false
      })
    });

    if (!addRes.ok) {
      const err = await addRes.json().catch(() => ({}));
      // "already exists" is fine — still send the email
      if (!err.message?.includes('already exists')) {
        console.error('[Waitlist] Audience add failed:', err);
      }
    }

    // 2. Send welcome email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'HireOpenClaw <hi@hireopenclaw.com>',
        to: [email],
        subject: "You're on the waitlist 🎉",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:500px;margin:0 auto;padding:32px;">
            <h2 style="margin:0 0 16px;">You're in, ${firstName}.</h2>
            <p style="color:#555;line-height:1.6;">
              Thanks for signing up for early access to HireOpenClaw. We're onboarding companies in small batches to make sure every AI employee is set up right.
            </p>
            <p style="color:#555;line-height:1.6;">
              We'll reach out soon with next steps. In the meantime, if you have questions, just reply to this email.
            </p>
            <p style="margin-top:24px;color:#555;">— The HireOpenClaw Team</p>
            <p style="margin-top:32px;font-size:12px;color:#999;">
              <a href="https://hireopenclaw.com" style="color:#999;">hireopenclaw.com</a> · A <a href="https://purplehorizons.io" style="color:#999;">Purple Horizons</a> product
            </p>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      console.error('[Waitlist] Email send failed:', err);
    }

    // 3. Notify team
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'HireOpenClaw <hi@hireopenclaw.com>',
        to: ['hi@hireopenclaw.com'],
        subject: `New waitlist signup: ${firstName} ${lastName}`,
        html: `<p><strong>${firstName} ${lastName}</strong></p><p>Email: ${email}</p>${phone ? `<p>Phone: ${phone}</p>` : ''}<p>Time: ${new Date().toISOString()}</p>`
      })
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Waitlist] Error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
