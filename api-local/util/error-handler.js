function globalErrorHandler(err, req, res, next) {
  console.error('[Global Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR'
  });
}

module.exports = { globalErrorHandler };
