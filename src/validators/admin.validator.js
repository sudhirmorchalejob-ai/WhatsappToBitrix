const { z } = require('zod');

/**
 * POST /api/admin/messages/retry — triggers the retry job for stuck
 * outgoing messages. Bounded so a manual kick can't hammer the provider.
 */
const retryOutgoingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  maxRetries: z.coerce.number().int().positive().max(10).default(3),
  olderThanMinutes: z.coerce.number().int().positive().max(1440).default(5),
});

/**
 * GET /api/admin/webhooks — audit log of received webhooks.
 */
const listWebhookLogsQuerySchema = z.object({
  source: z.enum(['WHATSBOX', 'META', 'BITRIX24']).optional(),
  status: z.enum(['RECEIVED', 'PROCESSED', 'FAILED']).optional(),
  ...require('./common').pagination,
});

module.exports = { retryOutgoingQuerySchema, listWebhookLogsQuerySchema };
