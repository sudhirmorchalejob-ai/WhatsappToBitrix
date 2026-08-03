const { sendError } = require('../utils/ApiResponse');

function notFound(req, res) {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

module.exports = notFound;
