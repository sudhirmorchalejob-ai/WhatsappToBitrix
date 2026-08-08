const logger = require('../utils/logger');

const log = logger.childFor('http');

/**
 * Access log middleware. Logs on response finish (captures real status code).
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    const entry = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.get('user-agent') || '-',
    };

    if (res.statusCode >= 500) log.error('request failed', entry);
    else if (res.statusCode >= 400) log.warn('request warn', entry);
    else log.http('request ok', entry);
  });

  next();
}

module.exports = requestLogger;
