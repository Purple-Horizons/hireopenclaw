/**
 * Input validation utilities — prevents command injection
 */

// Strict alphanumeric + hyphen + underscore (for tenantId, containerName, etc.)
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;

// Backup ID format: bk-{timestamp}-{hex}
const SAFE_BACKUP_ID = /^bk-\d{13}-[a-f0-9]{8}$/;

// Email — basic validation (not injection-safe for shell, but validates format)
const SAFE_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Bot name — alphanumeric, spaces, hyphens, apostrophes (no shell metacharacters)
const SAFE_BOT_NAME = /^[a-zA-Z0-9 _\-'.]{1,64}$/;

// Plan names
const VALID_PLANS = new Set(['free', 'starter', 'pro', 'business', 'enterprise']);

// Templates
const VALID_TEMPLATES = new Set(['blank', 'assistant', 'content', 'support', 'sales']);

function validateTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return false;
  return SAFE_ID.test(tenantId);
}

function validateBackupId(backupId) {
  if (!backupId || typeof backupId !== 'string') return false;
  return SAFE_BACKUP_ID.test(backupId);
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return SAFE_EMAIL.test(email) && email.length <= 254;
}

function validateBotName(name) {
  if (!name || typeof name !== 'string') return false;
  return SAFE_BOT_NAME.test(name);
}

function validatePlan(plan) {
  return !plan || VALID_PLANS.has(plan);
}

function validateTemplate(template) {
  return !template || VALID_TEMPLATES.has(template);
}

function validateLines(lines) {
  const n = parseInt(lines);
  if (isNaN(n)) return 50; // default
  return Math.min(Math.max(n, 1), 500);
}

module.exports = {
  validateTenantId,
  validateBackupId,
  validateEmail,
  validateBotName,
  validatePlan,
  validateTemplate,
  validateLines,
  SAFE_ID,
  SAFE_BACKUP_ID,
  SAFE_EMAIL,
  SAFE_BOT_NAME,
};
