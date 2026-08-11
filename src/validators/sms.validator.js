const { z } = require('zod');
const { SMS_CONFIG_KEYS, SMS_PROVIDERS } = require('../services/sms/config.service');

/**
 * PUT /api/sms/config — tenant SMS gateway overrides. An empty string
 * removes the override (falls back to the env default). Secret keys are
 * stored with isSecret=true and never echoed back.
 */
const smsConfigSchema = z.object({
  [SMS_CONFIG_KEYS.PROVIDER]: z.enum(SMS_PROVIDERS).optional(),
  [SMS_CONFIG_KEYS.API_URL]: z
    .union([z.string().url('SMS_API_URL must be a valid URL'), z.literal('')])
    .optional(),
  [SMS_CONFIG_KEYS.API_KEY]: z.string().max(500).optional(),
  [SMS_CONFIG_KEYS.SENDER_ID]: z.string().max(100).optional(),
  [SMS_CONFIG_KEYS.ROUTE]: z.string().max(100).optional(),
  [SMS_CONFIG_KEYS.TEMPLATE_ID]: z.string().max(255).optional(),
  [SMS_CONFIG_KEYS.WEBHOOK_SECRET]: z.string().max(500).optional(),
});

/**
 * POST /api/sms/test — `action: connection` probes the gateway; `action:
 * send` dispatches a real test SMS to `to`.
 */
const smsTestSchema = z.object({
  action: z.enum(['connection', 'send']).default('connection'),
  to: z.string().min(3, 'Recipient phone is required for a test send').max(50).optional(),
});

module.exports = { smsConfigSchema, smsTestSchema };
