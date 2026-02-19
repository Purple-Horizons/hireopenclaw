const { plans, VALID_PLANS } = require('../data/plans.js');

// Keep legacy aliases mapped to canonical plan IDs.
const PLAN_ALIASES = {
  professional: 'pro',
  team: 'business',
  agency: 'business',
};

const PLAN_PRICE_ENV = {
  starter: ['STRIPE_PRICE_STARTER'],
  pro: ['STRIPE_PRICE_PRO'],
  business: ['STRIPE_PRICE_BUSINESS', 'STRIPE_PRICE_TEAM'],
  enterprise: ['STRIPE_PRICE_ENTERPRISE'],
};

function normalizePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== 'string') return null;
  const key = rawPlan.trim().toLowerCase();
  const canonical = PLAN_ALIASES[key] || key;
  return VALID_PLANS.has(canonical) ? canonical : null;
}

function getStripePriceIdForPlan(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return null;
  const envKeys = PLAN_PRICE_ENV[normalized] || [];
  for (const envKey of envKeys) {
    const value = process.env[envKey];
    if (value) return value;
  }
  return null;
}

function getPlanByStripePriceId(priceId) {
  if (!priceId) return null;
  for (const [plan, envKeys] of Object.entries(PLAN_PRICE_ENV)) {
    for (const envKey of envKeys) {
      if (process.env[envKey] && process.env[envKey] === priceId) {
        return plan;
      }
    }
  }
  return null;
}

function getPlanAmountCents(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return null;
  const record = plans[normalized];
  if (!record || record.price === null || record.price === undefined) return null;
  return Math.round(Number(record.price) * 100);
}

function getPlanDisplayName(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return null;
  return plans[normalized]?.name || normalized;
}

function getCheckoutEligiblePlans() {
  return Object.entries(plans)
    .filter(([, meta]) => Number.isFinite(meta.price) && meta.price > 0)
    .map(([plan]) => plan);
}

module.exports = {
  normalizePlan,
  getStripePriceIdForPlan,
  getPlanByStripePriceId,
  getPlanAmountCents,
  getPlanDisplayName,
  getCheckoutEligiblePlans,
  PLAN_ALIASES,
};
