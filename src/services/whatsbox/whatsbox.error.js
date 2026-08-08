/**
 * Error raised by the WhatsBox client. `code` carries the provider error
 * code; mapped to HTTP 502 by the central error handler.
 */
class WhatsBoxApiError extends Error {
  constructor(message, code = 'UNKNOWN', statusCode = 502, details = null) {
    super(message);
    this.name = 'WhatsBoxApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { WhatsBoxApiError };
