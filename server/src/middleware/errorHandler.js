import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

const isInfraError = (err) =>
  ['MongoNetworkError', 'MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNotConnectedError'].includes(err.name) ||
  err.name === 'MaxRetriesPerRequestError' || /Connection is closed|ECONNREFUSED/i.test(err.message || '');

// Centralized error handler. Never leaks stack traces or internals to clients.
export function createErrorHandler(logger) {
  return (err, req, res, _next) => {
    if (res.headersSent) return res.end();
    let status = 500;
    let body = { code: 'INTERNAL_ERROR', message: 'Internal server error' };

    if (err instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
      };
    } else if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    } else if (err.type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'INVALID_JSON', message: 'Malformed JSON body' };
    } else if (isInfraError(err)) {
      status = 503;
      body = { code: 'SERVICE_UNAVAILABLE', message: 'A required backing service is unavailable. Please retry shortly.' };
    }

    (status >= 500 ? logger.error : logger.warn)('request.failed', { method: req.method, path: req.path, status, err });
    res.status(status).json({ success: false, error: body });
  };
}
