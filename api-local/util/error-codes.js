const ERROR_CODES = {
  // Auth
  AUTH_REQUIRED: { code: 'AUTH_REQUIRED', status: 401, message: 'Authentication required' },
  AUTH_INVALID: { code: 'AUTH_INVALID', status: 401, message: 'Invalid credentials' },
  AUTH_EXPIRED: { code: 'AUTH_EXPIRED', status: 401, message: 'Session expired' },
  ADMIN_REQUIRED: { code: 'ADMIN_REQUIRED', status: 403, message: 'Admin access required' },
  CSRF_INVALID: { code: 'CSRF_INVALID', status: 403, message: 'Invalid CSRF token' },
  
  // Validation
  INVALID_INPUT: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  MISSING_FIELD: { code: 'MISSING_FIELD', status: 400, message: 'Required field missing' },
  INVALID_TENANT_ID: { code: 'INVALID_TENANT_ID', status: 400, message: 'Invalid tenant ID format' },
  METHOD_NOT_ALLOWED: { code: 'METHOD_NOT_ALLOWED', status: 405, message: 'Method not allowed' },
  
  // Resources
  NOT_FOUND: { code: 'NOT_FOUND', status: 404, message: 'Resource not found' },
  ACCESS_DENIED: { code: 'ACCESS_DENIED', status: 403, message: 'Access denied' },
  
  // Operations
  PROVISION_FAILED: { code: 'PROVISION_FAILED', status: 500, message: 'Bot provisioning failed' },
  DOCKER_ERROR: { code: 'DOCKER_ERROR', status: 500, message: 'Container operation failed' },
  BACKUP_FAILED: { code: 'BACKUP_FAILED', status: 500, message: 'Backup operation failed' },
  
  // Rate limiting
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429, message: 'Too many requests' },
  
  // Internal
  INTERNAL: { code: 'INTERNAL_ERROR', status: 500, message: 'Internal server error' },
};

function apiError(errorDef, details) {
  return {
    error: errorDef.message,
    code: errorDef.code,
    ...(details && process.env.NODE_ENV === 'development' && { details })
  };
}

module.exports = { ERROR_CODES, apiError };
