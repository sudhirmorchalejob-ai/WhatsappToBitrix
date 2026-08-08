const config = require('../config');
const { sendError } = require('../utils/ApiResponse');

const AUTH_HEADER = 'x-api-key';

/**
 * Guards internal endpoints. Reads `x-api-key` (or `Authorization: Bearer`).
 * Rejects with 503 if no API keys are configured, 401 on mismatch.
 */
function apiKeyAuth(req, res, next) {
  if (config.apiKeys.length === 0) {
    return sendError(res, 'API keys are not configured on the server', 503);
  }

  const header = req.get(AUTH_HEADER) || '';
  const bearer = req.get('authorization') || '';
  const token = header || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');

  if (!token || !config.apiKeys.includes(token)) {
    return sendError(res, 'Invalid or missing API key', 401);
  }

  next();
}

module.exports = apiKeyAuth;
