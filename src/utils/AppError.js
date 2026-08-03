/**
 * Domain error class. Central error handler maps it to an HTTP response.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null, code = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
