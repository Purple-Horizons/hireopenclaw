# HireOpenClaw Setup Guide

## Vercel Environment Variables

Add these to your Vercel project settings:

### Required

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `RESEND_API_KEY` | Email notifications | [resend.com/api-keys](https://resend.com/api-keys) |
| `ANTHROPIC_API_KEY` | AI chat intake | [console.anthropic.com](https://console.anthropic.com) |

### For Stripe Payments

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `STRIPE_SECRET_KEY` | Server-side Stripe | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PRICE_SOLO` | Solo plan price ID ($49/mo) | Create in Stripe Dashboard |
| `STRIPE_PRICE_TEAM` | Team plan price ID ($149/mo) | Create in Stripe Dashboard |
| `STRIPE_PRICE_SQUAD` | Squad plan price ID ($299/mo) | Create in Stripe Dashboard |
| `STRIPE_PRICE_SETUP` | Setup fee price ID ($99) | Create in Stripe Dashboard |
| `SITE_URL` | Your site URL | `https://hireopenclaw.com` |

## Stripe Setup

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Create Products:
   - **Solo** - $49/month (recurring)
   - **Team** - $149/month (recurring)
   - **Squad** - $299/month (recurring)
   - **Setup Fee** - $99 one-time
3. Copy each Price ID (starts with `price_`)
4. Add to Vercel env vars

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/submit` | POST | Traditional form submission → Resend email |
| `/api/chat` | POST | AI chat intake → Claude API |
| `/api/checkout` | POST | Stripe checkout session |

## Files Added

```
api/
  submit.js     # Form → Resend (existing)
  chat.js       # AI intake interview (new)
  checkout.js   # Stripe checkout (new)
  
chat-widget.js  # Frontend chat UI (new)
success.html    # Post-payment page (new)
```

## Usage

### AI Chat Intake

```html
<div id="chatContainer"></div>
<script src="/chat-widget.js"></script>
<script>
  const chat = new IntakeChat('chatContainer', (data) => {
    // Called when interview complete
    console.log('Intake complete:', data);
    // Submit to /api/submit or redirect to checkout
  });
  
  // Start after collecting basic info
  chat.setClientInfo({
    name: 'Jane Smith',
    business: 'Acme Corp',
    email: 'jane@acme.com'
  });
</script>
```

### Stripe Checkout

```javascript
fetch('/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    plan: 'solo', // or 'team', 'squad'
    email: 'customer@email.com',
    includeSetup: false // true to add $99 setup fee
  })
})
.then(res => res.json())
.then(data => {
  window.location.href = data.url; // Redirect to Stripe
});
```

## Deploy

```bash
cd ~/dev/hireopenclaw
npm install
git add .
git commit -m "Add Stripe checkout and AI chat intake"
git push
```

Vercel will auto-deploy.

## Testing

1. Set env vars in Vercel
2. Test form submission (check email)
3. Test AI chat (check responses)
4. Test Stripe checkout (use test mode)
