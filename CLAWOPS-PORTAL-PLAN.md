# ClawOps Client Portal - Adaptation Plan

## Current State (hireopenclaw.com)
- Static HTML marketing site
- Vercel serverless API (Stripe checkout, Resend emails, Claude chat intake)
- Pricing: Solo $49, Team $149, Squad $299
- No auth, no dashboard, no bot management

## Target State (clawops.purplehorizons.io or hireopenclaw.com)
- Marketing page + authenticated client portal
- Bot management dashboard
- Usage metrics + billing
- Self-service provisioning via templates

## Phase 1: Rebrand + Pricing Update (Quick Win)
- [ ] Update copy: "HireOpenClaw" -> "ClawOps by Purple Horizons"
- [ ] Update pricing to match ClawOps tiers:
  - Starter $299/mo (was Solo $49)
  - Professional $799/mo (was Team $149)
  - Enterprise Custom (was Squad $299)
- [ ] Update Stripe price IDs in Vercel env
- [ ] Update features per tier (bot counts, modes, templates)
- [ ] Update hero: "Your AI Team, Managed" or similar
- [ ] Update OG image + meta tags
- [ ] Update form fields for ClawOps-specific intake
- [ ] Keep AI chat intake (great differentiator)

## Phase 2: Client Dashboard (New)
- [ ] Add auth (Supabase or Clerk for simplicity)
- [ ] Dashboard route: `/dashboard`
- [ ] Show tenant's bots with status (active/paused)
- [ ] Usage chart (tokens consumed vs limit)
- [ ] Billing section (Stripe customer portal link)
- [ ] Bot config viewer (read-only initially)

## Phase 3: Self-Service Bot Management
- [ ] "Add Bot" flow with template picker
- [ ] Pause/resume buttons
- [ ] View bot logs
- [ ] Upgrade plan (Stripe checkout)
- [ ] API integration with DynamoDB via serverless functions

## Architecture Decision
Keep static HTML + Vercel serverless. Don't over-engineer.
- Marketing: index.html (public)
- Dashboard: dashboard.html (authenticated)
- API: Vercel functions (auth middleware + DynamoDB/Stripe)

## API Endpoints Needed (Phase 2+)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/login` | POST | No | Email magic link or OAuth |
| `/api/dashboard/bots` | GET | Yes | List tenant's bots |
| `/api/dashboard/usage` | GET | Yes | Usage metrics |
| `/api/dashboard/billing` | GET | Yes | Stripe customer portal URL |
| `/api/dashboard/bot/pause` | POST | Yes | Pause a bot |
| `/api/dashboard/bot/resume` | POST | Yes | Resume a bot |

## Files to Add
```
dashboard.html          # Client dashboard UI
api/auth/login.js       # Auth handler
api/auth/verify.js      # Token verification
api/dashboard/bots.js   # List bots
api/dashboard/usage.js  # Usage data
api/dashboard/billing.js # Stripe portal
```
