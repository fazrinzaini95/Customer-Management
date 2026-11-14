// Wraps an async route handler so rejected promises reach the error handler
// instead of crashing the process or hanging the request.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Central error handler — keep this last in the middleware chain.
// Never leaks stack traces or raw DB errors to the client.
function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === 'ZodError') {
    const first = err.errors && err.errors[0];
    let msg = first && first.message;
    const where = first && first.path && first.path.length ? first.path.join(' › ') : '';
    if (!msg || msg === 'Required') msg = where ? `"${where}" is required` : 'A required field is missing';
    else if (msg === 'Invalid input' || /^Invalid /.test(msg) || /^Expected /.test(msg)) msg = where ? `"${where}" is not in the right format` : 'Some of the information is not in the right format';
    return res.status(400).json({ error: msg, details: err.errors });
  }
  if (err.code === '23505') { // Postgres unique_violation
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(409).json({ error: 'This record is referenced elsewhere and cannot be modified' });
  }

  if (typeof err.code === 'string' && /^22/.test(err.code)) { // Postgres data exception: bad date / number / text format
    return res.status(400).json({ error: 'One of the values is not in the right format (for example an invalid date). Please check and try again.' });
  }

  res.status(err.status || 500).json({ error: err.publicMessage || 'Something went wrong' });
}

module.exports = { asyncHandler, errorHandler };
