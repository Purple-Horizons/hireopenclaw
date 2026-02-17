function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function globalErrorHandler(err, req, res, next) {
  console.error(`[Error] ${req.method} ${req.path}:`, err);
  
  // Don't leak stack traces or internal details
  const statusCode = err.statusCode || 500;
  const message = statusCode < 500 ? err.message : 'Internal server error';
  
  res.status(statusCode).json({
    error: message,
    ...(err.code && { code: err.code }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { asyncHandler, globalErrorHandler, AppError };
