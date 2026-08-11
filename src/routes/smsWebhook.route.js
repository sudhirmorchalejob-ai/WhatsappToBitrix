const { Router, raw } = require('express');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const { SmsWebhookController } = require('../controllers/smsWebhook.controller');

const controller = new SmsWebhookController();
const router = Router();

// SMS gateway delivery reports. Raw body is captured so HMAC verification
// runs over the exact bytes the gateway signed.
router.post('/sms', webhookRateLimiter, raw({ type: '*/*', limit: '10mb' }), (req, res) =>
  controller.handle(req, res)
);

module.exports = router;
