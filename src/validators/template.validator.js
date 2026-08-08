const { z } = require('zod');
const { pagination, queryBoolean } = require('./common');

const templateNameSchema = z.string().trim().min(1, 'Name is required').max(255);
const templateBodySchema = z.string().trim().min(1, 'Body is required').max(4096);
const templateCategorySchema = z.string().trim().min(1).max(100).optional();
const templateIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * POST /api/templates — create a reply template. `isDefault` designates
 * the fallback for auto-reply; promoting one unsets the others.
 */
const createTemplateSchema = z.object({
  name: templateNameSchema,
  body: templateBodySchema,
  category: templateCategorySchema,
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * PUT /api/templates/:id — partial update (all fields optional).
 */
const updateTemplateSchema = z.object({
  name: templateNameSchema.optional(),
  body: templateBodySchema.optional(),
  category: z.union([z.string().trim().min(1).max(100), z.literal(null)]).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/templates — optional filters + pagination.
 */
const listTemplatesQuerySchema = z.object({
  isActive: queryBoolean(undefined),
  category: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  ...pagination,
});

module.exports = {
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,
};
