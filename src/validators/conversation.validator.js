const { z } = require('zod');
const { CONVERSATION_STATUS } = require('../constants');
const { pagination } = require('./common');

/**
 * GET /api/conversations — filter by status / assigned agent, free-text
 * search over the linked contact, paginated.
 */
const listConversationsQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(Object.values(CONVERSATION_STATUS)).optional(),
  assignedAgentId: z.coerce.number().int().positive().optional(),
  ...pagination,
});

/**
 * GET /api/conversations/:id — validate the URL param.
 */
const conversationParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * POST /api/conversations/:id/assign — manual assign by Bitrix24 user id
 * (the operator id known to the external app).
 */
const assignConversationBodySchema = z.object({
  byUserId: z.coerce.number().int().positive(),
});

module.exports = { listConversationsQuerySchema, conversationParamSchema, assignConversationBodySchema };
