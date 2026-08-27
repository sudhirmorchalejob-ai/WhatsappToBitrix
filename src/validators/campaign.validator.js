const { z } = require('zod');
const { pagination } = require('./common');

const campaignNameSchema = z.string().trim().min(1, 'Name is required').max(255);
const campaignBodySchema = z.string().trim().min(1, 'Body is required').max(4096);
const campaignMediaUrlSchema = z.string().url('mediaUrl must be a valid public URL').max(2000);
const campaignCaptionSchema = z.string().trim().max(1000).optional();
const campaignRecipientsSchema = z.array(z.string().trim().min(1)).max(10000).optional();
const campaignSegmentIdSchema = z.string().trim().min(1).max(100);
const campaignTemplateParamsSchema = z.array(z.string().max(500)).max(20).optional();
const campaignIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * POST /api/campaigns — create a WhatsApp marketing campaign. `type`
 * selects TEXT vs MEDIA payload; recipients are an array of phone
 * numbers (any format, normalized by the service) or `segmentId` targets
 * a Bitrix24 audience segment resolved at launch time.
 */
const createCampaignSchema = z
  .object({
    name: campaignNameSchema,
    type: z.enum(['TEXT', 'MEDIA', 'TEMPLATE']).default('TEXT'),
    body: campaignBodySchema.optional(),
    mediaUrl: campaignMediaUrlSchema.optional(),
    caption: campaignCaptionSchema,
    recipients: campaignRecipientsSchema,
    segmentId: campaignSegmentIdSchema.optional(),
    segmentName: z.string().trim().max(255).optional(),
    templateName: z.string().trim().min(1).max(255).optional(),
    templateLanguage: z.string().trim().min(2).max(10).optional().default('en'),
    templateParams: campaignTemplateParamsSchema,
  })
  .superRefine((data, ctx) => {
    if (data.type === 'TEXT' && !data.body) {
      ctx.addIssue({ path: ['body'], message: 'Body is required for TEXT campaigns' });
    }
    if (data.type === 'MEDIA' && !data.mediaUrl) {
      ctx.addIssue({ path: ['mediaUrl'], message: 'mediaUrl is required for MEDIA campaigns' });
    }
    if (data.type === 'TEMPLATE' && !data.templateName) {
      ctx.addIssue({ path: ['templateName'], message: 'templateName is required for TEMPLATE campaigns' });
    }
  });

/**
 * PUT /api/campaigns/:id — partial update (all fields optional).
 */
const updateCampaignSchema = z.object({
  name: campaignNameSchema.optional(),
  type: z.enum(['TEXT', 'MEDIA', 'TEMPLATE']).optional(),
  body: z.union([campaignBodySchema, z.literal(null)]).optional(),
  mediaUrl: z.union([campaignMediaUrlSchema, z.literal(null)]).optional(),
  caption: z.union([campaignCaptionSchema, z.literal(null)]).optional(),
  recipients: campaignRecipientsSchema,
  segmentId: z.union([campaignSegmentIdSchema, z.literal(null)]).optional(),
  segmentName: z.union([z.string().trim().max(255), z.literal(null)]).optional(),
  templateName: z.union([z.string().trim().min(1).max(255), z.literal(null)]).optional(),
  templateLanguage: z.union([z.string().trim().min(2).max(10), z.literal(null)]).optional(),
  templateParams: z.union([campaignTemplateParamsSchema, z.literal(null)]).optional(),
});

/**
 * GET /api/campaigns — optional filters + pagination.
 */
const listCampaignsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED']).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  ...pagination,
});

/**
 * POST /api/campaigns/:id/execute — optionally add recipients (or a
 * segment) then launch.
 */
const executeCampaignSchema = z.object({
  recipients: campaignRecipientsSchema,
  segmentId: campaignSegmentIdSchema.optional(),
});

module.exports = {
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsQuerySchema,
  campaignIdParamSchema,
  executeCampaignSchema,
};
