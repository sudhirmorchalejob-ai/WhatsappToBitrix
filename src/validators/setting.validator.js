const { z } = require('zod');

/**
 * PUT/POST /api/settings — key/value configuration persisted in the DB.
 * `value` is stored as JSON; `type` hints the settings screen on how to
 * render/edit it; `isSecret` masks the value in list responses.
 */
const setSettingSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .max(100)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Key may contain letters, numbers, dots, dashes and underscores only'),
  value: z.unknown(),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  description: z.string().max(500).nullable().optional(),
  isSecret: z.boolean().default(false),
});

/**
 * GET /api/settings?includeSecrets=true — rarely needed; listing secrets
 * is deliberately opt-in.
 */
const listSettingsQuerySchema = z.object({
  includeSecrets: z
    .preprocess((v) => (v === 'true' || v === '1'), z.boolean())
    .optional()
    .default(false),
});

/**
 * DELETE /api/settings/:key
 */
const settingParamSchema = z.object({
  key: z.string().trim().min(1).max(100),
});

module.exports = { setSettingSchema, listSettingsQuerySchema, settingParamSchema };
