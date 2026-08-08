const { Router, json, urlencoded } = require('express');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const { verifyBitrix24Webhook } = require('../webhooks/bitrix24/webhookAuth');
const bitrix24WebhookController = require('../webhooks/bitrix24/webhook.controller');

const router = Router();

// Bitrix24 delivers events as application/x-www-form-urlencoded (nested
// data/auth blocks in bracket notation, or as JSON strings). Accept both
// that and plain application/json so manual injections keep working.
router.post(
  '/bitrix24',
  webhookRateLimiter,
  json(),
  urlencoded({ extended: true }),
  verifyBitrix24Webhook,
  bitrix24WebhookController.handle
);

module.exports = router;
