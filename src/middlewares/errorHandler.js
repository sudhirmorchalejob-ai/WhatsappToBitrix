const { env } = require('../config');
const AppError = require('../utils/AppError');
const { sendError } = require('../utils/ApiResponse');
const logger = require('../utils/logger');
const { Bitrix24ApiError } = require('../services/bitrix24/bitrix24.error');
const { WhatsBoxApiError } = require('../services/whatsbox/whatsbox.error');

const log = logger.childFor('error-handler');

/**
 * Maps known error shapes to a consistent JSON error response.
 */
function toResponseError(err) {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, errors: err.details };
  }

  if (err instanceof Bitrix24ApiError) {
    return { status: err.statusCode, message: err.message, errors: err.details };
  }

  if (err instanceof WhatsBoxApiError) {
    return { status: err.statusCode, message: err.message, errors: err.details };
  }

  if (err.name === 'ZodError') {
    const errors = (err.issues || []).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return { status: 400, message: 'Validation failed', errors };
  }

  if (err.name === 'PrismaClientKnownRequestError') {
    const map = {
      P2002: { status: 409, message: 'Duplicate value for a unique field' },
      P2025: { status: 404, message: 'Record not found' },
      P2003: { status: 409, message: 'Related record constraint failed' },
    };
    const mapped = map[err.code];
    if (mapped) return { ...mapped, errors: err.meta };
  }

  if (err.name === 'PrismaClientValidationError') {
    return { status: 400, message: 'Invalid data supplied to database' };
  }

  if (err.name === 'RateLimitError') {
    return { status: 429, message: 'Too many requests, please try again later.' };
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const mapped = toResponseError(err);

  if (mapped) {
    log.warn(`${err.message} (${mapped.status})`, { method: req.method, url: req.originalUrl });
    return sendError(res, mapped.message, mapped.status, mapped.errors);
  }

  log.error('Unhandled error', {
    method: req.method,
    url: req.originalUrl,
    stack: err.stack,
  });

  if (env.NODE_ENV === 'production') {
    return sendError(res, 'Internal server error', 500);
  }

  return sendError(res, err.message || 'Internal server error', 500);
}

module.exports = errorHandler;
