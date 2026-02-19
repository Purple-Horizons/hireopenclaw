/**
 * Environment validation — checks required env vars on startup
 */
function validateEnv() {
  // In test/dev mode, skip strict validation
  if (process.env.NODE_ENV === 'test') return;

  const isProduction = process.env.NODE_ENV === 'production';
  const warnings = [];
  const errors = [];
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    warnings.push('AWS_REGION/AWS_DEFAULT_REGION not set (defaulting to us-east-1)');
  }

  if (isProduction) {
    const required = [
      'SECRETS_ENCRYPTION_KEY',
      'CSRF_SECRET',
    ];
    for (const key of required) {
      if (!process.env[key]) {
        errors.push(`${key} must be set in production`);
      }
    }
    if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
      errors.push('AWS_REGION or AWS_DEFAULT_REGION must be set in production');
    }

    if (process.env.SECRETS_ENCRYPTION_KEY === 'clawops-local-dev-key-change-in-production') {
      errors.push('SECRETS_ENCRYPTION_KEY cannot use development default in production');
    }
    if (process.env.MAGIC_LINK_DEV_TOKENS === 'true') {
      errors.push('MAGIC_LINK_DEV_TOKENS must be disabled in production');
    }
  }

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(`[env-check] ⚠ ${w}`));
  }
  if (errors.length > 0) {
    errors.forEach(e => console.error(`[env-check] ✗ ${e}`));
    throw new Error('Environment validation failed');
  }
}

module.exports = { validateEnv };
