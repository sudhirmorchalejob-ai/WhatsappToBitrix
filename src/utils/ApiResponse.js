/**
 * Unified HTTP response envelope.
 * Success: { success: true, data, message?, meta? }
 * Error:   { success: false, message, errors? }
 */

function sendSuccess(res, data, options = {}) {
  const { status = 200, message, meta } = options;
  const body = { success: true };
  if (message) body.message = message;
  body.data = data ?? null;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function sendCreated(res, data, options = {}) {
  return sendSuccess(res, data, { ...options, status: 201 });
}

function sendError(res, message, status = 500, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

module.exports = { sendSuccess, sendCreated, sendError };
