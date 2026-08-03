const { z } = require('zod');
const { MESSAGE_TYPE, MESSAGE_STATUS, MESSAGE_DIRECTION } = require('../constants');
const { pagination, queryBoolean } = require('./common');

const phoneSchema = z.string().min(3, 'Phone must contain at least 3 digits');

/**
 * POST /api/messages/send — outgoing text message.
 * `to` may be a raw phone number (service normalizes it). The optional
 * conversationId/dealId link the record to existing CRM entities when
 * the sender already has an open conversation.
 */
const sendTextSchema = z.object({
  to: phoneSchema,
  body: z.string().min(1, 'Body is required').max(4096),
  previewUrl: z.boolean().optional(),
  channelId: z.string().min(1).max(255).optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  name: z.string().max(255).optional(),
  conversationId: z.coerce.number().int().positive().optional(),
  dealId: z.coerce.number().int().positive().optional(),
});

/**
 * POST /api/messages/media — outgoing media message.
 * `type` uses the same set WhatsBox accepts; PDFs are sent as
 * `document`. `link` must be a public URL (WhatsBox downloads it).
 */
const sendMediaSchema = z.object({
  to: phoneSchema,
  type: z.enum(['image', 'video', 'audio', 'document']),
  link: z.string().url('Media link must be a valid public URL'),
  caption: z.string().max(1000).optional(),
  filename: z.string().max(255).optional(),
  channelId: z.string().min(1).max(255).optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  name: z.string().max(255).optional(),
  conversationId: z.coerce.number().int().positive().optional(),
  dealId: z.coerce.number().int().positive().optional(),
});

/**
 * GET /api/messages — every filter optional, coerced from query strings.
 */
const listMessagesQuerySchema = z.object({
  conversationId: z.coerce.number().int().positive().optional(),
  contactId: z.coerce.number().int().positive().optional(),
  dealId: z.coerce.number().int().positive().optional(),
  direction: z.enum(Object.values(MESSAGE_DIRECTION)).optional(),
  status: z.enum(Object.values(MESSAGE_STATUS)).optional(),
  type: z.enum(Object.values(MESSAGE_TYPE)).optional(),
  mediaOnly: queryBoolean(false),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ...pagination,
});

/**
 * GET /api/messages/:id/conversation — fetch one message (params).
 */
const messageParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

module.exports = { sendTextSchema, sendMediaSchema, listMessagesQuerySchema, messageParamSchema };
