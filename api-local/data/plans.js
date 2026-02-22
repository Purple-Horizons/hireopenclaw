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
  starter: 20.00,
  pro: 80.00,
  business: 180.00,
  enterprise: 480.00
};

// Token limits per plan (mapped from interactions)
// Avg interaction: ~1,000 tokens (500 in + 500 out). Conservative estimate.
const TOKEN_MULTIPLIER = 1000;

for (const [key, plan] of Object.entries(plans)) {
  PLAN_PRICING[key] = { price: plan.price, maxBots: plan.employees };
  PLAN_TOKEN_LIMITS[key] = plan.interactions ? plan.interactions * TOKEN_MULTIPLIER : Infinity;
  PLAN_BOT_LIMITS[key] = plan.employees || Infinity;
}

const VALID_PLANS = new Set(Object.keys(plans));

// Overage rate per interaction (beyond plan cap)
const PLAN_OVERAGE_RATES = {};
for (const [key, plan] of Object.entries(plans)) {
  PLAN_OVERAGE_RATES[key] = plan.overageRate || 0.01;
}

// Model access per plan
const PLAN_MODELS = {};
for (const [key, plan] of Object.entries(plans)) {
  PLAN_MODELS[key] = plan.models || ['sonnet'];
}

// Usage record TTL — 90 days (TASK-250)
const USAGE_TTL_SECONDS = 90 * 24 * 60 * 60;

module.exports = {
  plans,
  PLAN_PRICING,
  PLAN_TOKEN_LIMITS,
  PLAN_BOT_LIMITS,
  PLAN_BUDGETS,
  VALID_PLANS,
  PLAN_OVERAGE_RATES,
  PLAN_MODELS,
  USAGE_TTL_SECONDS
};
