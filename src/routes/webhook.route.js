const { Router, raw } = require('express');
const webhookAuth = require('../middlewares/webhookAuth');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const webhookController = require('../webhooks/whatsbox/webhook.controller');

const router = Router();

// Raw body is required so HMAC verification runs over the exact bytes sent.
router.post(
  '/whatsbox',
  webhookRateLimiter,
  raw({ type: '*/*', limit: '10mb' }),
  webhookAuth,
  webhookController.handle
);

// Classic subscription-verification handshake (Meta-style).
router.get('/whatsbox', webhookAuth.verifyHubChallenge);

module.exports = router;
