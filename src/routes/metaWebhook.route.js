const { Router, raw } = require('express');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const { verifyMetaWebhook, verifyMetaChallenge } = require('../webhooks/meta/webhookAuth');
const metaWebhookController = require('../webhooks/meta/webhook.controller');

const router = Router();

// Raw body is required so the X-Hub-Signature-256 HMAC runs over the
// exact bytes Meta sent.
router.post(
  '/meta',
  webhookRateLimiter,
  raw({ type: '*/*', limit: '10mb' }),
  verifyMetaWebhook,
  metaWebhookController.handle
);

// Meta subscription verification handshake.
router.get('/meta', verifyMetaChallenge);

module.exports = router;
