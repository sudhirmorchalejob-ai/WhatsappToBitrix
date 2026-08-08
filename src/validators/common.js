const { z } = require('zod');
const { sendError } = require('../utils/ApiResponse');

const MAX_LIMIT = 100;

/**
 * Shared pagination fields. `coerce` is essential for query strings:
 * Express delivers every query value as a string, so `?limit=25` must be
 * coerced to the number 25 before it reaches repositories/Prisma.
 */
const pagination = {
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
};

/**
 * URL param id (coerced from string, e.g. /contacts/42 -> 42).
 */
const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Query-string boolean. `z.coerce.boolean()` cannot be used because
 * Boolean('false') === true. This preprocessor maps only 'true'/'1' to
 * true and keeps the type honest.
 */
function queryBoolean(defaultValue = false) {
  return z
    .preprocess((v) => {
      if (v === undefined) return undefined;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1';
    }, z.boolean())
    .default(defaultValue);
}

/**
 * Express middleware factory. Validates one request source (body /
 * query / params) against a Zod schema. On success it REPLACES the
 * source with the parsed (coerced + defaulted) data, so controllers and
 * services receive typed values. On failure it returns a structured 400
 * using the shared error envelope, keeping the error format identical to
 * the global handler.
 */
function validate(schema, source = 'body') {
  return function validator(req, res, next) {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return sendError(res, 'Validation failed', 400, errors);
    }
    req[source] = parsed.data;
    return next();
  };
}

module.exports = { pagination, idParamSchema, queryBoolean, validate, MAX_LIMIT };
