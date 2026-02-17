/**
 * Plans — Single Source of Truth (TASK-149)
 * All plan data lives in plans.json. Import from here.
 */
const plans = require('./plans.json');

// Derive plan-specific lookups
const PLAN_PRICING = {};
const PLAN_TOKEN_LIMITS = {};
const PLAN_BOT_LIMITS = {};
const PLAN_BUDGETS = {
  free: 5.00,
  starter: 20.00,
  pro: 80.00,
  business: 180.00,
  enterprise: 480.00
};

// Token limits per plan (mapped from interactions)
const TOKEN_MULTIPLIER = 100; // tokens per interaction (approx)

for (const [key, plan] of Object.entries(plans)) {
  PLAN_PRICING[key] = { price: plan.price, maxBots: plan.employees };
  PLAN_TOKEN_LIMITS[key] = plan.interactions ? plan.interactions * TOKEN_MULTIPLIER : Infinity;
  PLAN_BOT_LIMITS[key] = plan.employees || Infinity;
}

const VALID_PLANS = new Set(Object.keys(plans));

// Usage record TTL — 90 days (TASK-250)
// Writers should set: expiresAt = Math.floor(Date.now() / 1000) + USAGE_TTL_SECONDS
const USAGE_TTL_SECONDS = 90 * 24 * 60 * 60;

module.exports = { plans, PLAN_PRICING, PLAN_TOKEN_LIMITS, PLAN_BOT_LIMITS, PLAN_BUDGETS, VALID_PLANS, USAGE_TTL_SECONDS };
