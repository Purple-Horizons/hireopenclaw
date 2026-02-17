/**
 * Environment validation — checks required env vars on startup
 */
function validateEnv() {
  // In test/dev mode, skip strict validation
  if (process.env.NODE_ENV === 'test') return;
  
  const warnings = [];
  if (!process.env.AWS_REGION) warnings.push('AWS_REGION not set (defaulting to us-east-1)');
  
  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(`[env-check] ⚠ ${w}`));
  }
}

module.exports = { validateEnv };
