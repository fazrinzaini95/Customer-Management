// Wraps an async route handler so rejected promises reach the error handler
// instead of crashing the process or hanging the request.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Central error handler — keep this last in the middleware chain.
// Never leaks stack traces or raw DB errors to the client.
function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  if (err.code === '23505') { // Postgres unique_violation
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(409).json({ error: 'This record is referenced elsewhere and cannot be modified' });
  }

  res.status(err.status || 500).json({ error: err.publicMessage || 'Something went wrong' });
}

module.exports = { asyncHandler, errorHandler };
