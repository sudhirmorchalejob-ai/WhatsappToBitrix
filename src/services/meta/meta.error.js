/**
 * Error raised by the Meta Cloud API client. `code` carries the Meta
 * error code (or HTTP status); mapped to the response status by the
 * central error handler.
 */
class MetaApiError extends Error {
  constructor(message, code = 'UNKNOWN', statusCode = 502, details = null) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { MetaApiError };
