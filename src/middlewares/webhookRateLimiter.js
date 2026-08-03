const rateLimit = require('express-rate-limit');
const { env } = require('../config');

/**
 * Provider webhook traffic bursts (batches of messages), so the
 * webhook endpoint gets a higher per-window allowance than the API.
 */
const webhookLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.WEBHOOK_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

module.exports = webhookLimiter;
