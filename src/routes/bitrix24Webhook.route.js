const { Router, raw } = require('express');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const { verifyBitrix24Webhook } = require('../webhooks/bitrix24/webhookAuth');
const bitrix24WebhookController = require('../webhooks/bitrix24/webhook.controller');

const router = Router();

// Raw body is required so the application_token payload can be parsed
// from the exact bytes Bitrix24 sent. Verification happens against the
// install row found via auth.member_id.
router.post(
  '/bitrix24',
  webhookRateLimiter,
  raw({ type: '*/*', limit: '10mb' }),
  verifyBitrix24Webhook,
  bitrix24WebhookController.handle
);

module.exports = router;
