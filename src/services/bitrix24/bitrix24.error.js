/**
 * Error raised by the Bitrix24 client. `code` is the B24 error code
 * (e.g. QUERY_LIMIT_EXCEEDED); mapped to HTTP 502 by the error handler.
 */
class Bitrix24ApiError extends Error {
  constructor(message, code = 'UNKNOWN', statusCode = 502, details = null) {
    super(message);
    this.name = 'Bitrix24ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { Bitrix24ApiError };
