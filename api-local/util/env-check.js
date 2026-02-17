/**
 * Environment Variable Validation
 * Called at startup to verify required configuration.
 */

const REQUIRED_VARS = [];

const RECOMMENDED_VARS = [
  'SECRETS_ENCRYPTION_KEY',
  'CLI_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

function validateEnv() {
  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const warned = RECOMMENDED_VARS.filter(v => !process.env[v]);
  if (warned.length > 0) {
    console.warn(`[Config] Recommended env vars not set: ${warned.join(', ')}`);
  }

  // Validate NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    const prodRequired = ['SECRETS_ENCRYPTION_KEY', 'STRIPE_SECRET_KEY'];
    const prodMissing = prodRequired.filter(v => !process.env[v]);
    if (prodMissing.length > 0) {
      console.error(`FATAL: Production requires: ${prodMissing.join(', ')}`);
      process.exit(1);
    }
  }
}

module.exports = { validateEnv };
