// Small HTTP helpers: typed errors, async handler wrapper, request logging.
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Express 4 does not forward rejected promises to the error handler.
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Logs method, path, status and timing only — never bodies, headers or tokens.
function requestLogger(logger = console) {
  return (req, res, next) => {
    const start = Date.now();
    req.id = crypto.randomBytes(4).toString('hex');
    // Path only: query strings can contain search terms from saved handoffs.
    const path = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      if (path === '/health') return;
      logger.log(`[${req.id}] ${req.method} ${path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  };
}

function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request is too large. Try Quick Summary mode or extract a shorter conversation.', code: 'PAYLOAD_TOO_LARGE' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON.', code: 'INVALID_JSON' });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    logger.error(`[${req.id || '-'}] Unhandled error on ${req.method} ${req.path}: ${err.stack || err.message}`);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
  };
}

module.exports = { HttpError, asyncHandler, requestLogger, errorHandler };
