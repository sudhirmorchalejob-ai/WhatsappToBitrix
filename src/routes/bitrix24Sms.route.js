const { Router, json, urlencoded } = require('express');
const webhookRateLimiter = require('../middlewares/webhookRateLimiter');
const { Bitrix24SmsController } = require('../controllers/bitrix24Sms.controller');

const controller = new Bitrix24SmsController();
const router = Router();

// Bitrix24 Message Service provider handler. Public by design (called by
// Bitrix24 with the provider `code` in the body), rate-limited like other
// provider callbacks.
router.post(
  '/sms',
  webhookRateLimiter,
  json({ limit: '5mb' }),
  urlencoded({ extended: true, limit: '1mb' }),
  (req, res) => controller.handle(req, res)
);

module.exports = router;
