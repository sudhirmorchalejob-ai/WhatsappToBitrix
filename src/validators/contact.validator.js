const { z } = require('zod');
const { SYNC_STATUS } = require('../constants');
const { pagination } = require('./common');

/**
 * GET /api/contacts — search by name/phone fragment, filter by sync
 * state, paginated.
 */
const listContactsQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  syncStatus: z.enum(Object.values(SYNC_STATUS)).optional(),
  ...pagination,
});

/**
 * GET /api/contacts/:id — validate the URL param.
 */
const contactParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

module.exports = { listContactsQuerySchema, contactParamSchema };
