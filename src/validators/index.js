const { validate, pagination, idParamSchema, queryBoolean, MAX_LIMIT } = require('./common');
const { forgotPasswordSchema, resetPasswordSchema } = require('./auth.validator');
const {
  sendTextSchema,
  sendMediaSchema,
  listMessagesQuerySchema,
  messageParamSchema,
} = require('./message.validator');
const { listContactsQuerySchema, contactParamSchema } = require('./contact.validator');
const { listConversationsQuerySchema, conversationParamSchema, assignConversationBodySchema } = require('./conversation.validator');
const { setSettingSchema, listSettingsQuerySchema, settingParamSchema } = require('./setting.validator');
const { retryOutgoingQuerySchema, listWebhookLogsQuerySchema } = require('./admin.validator');
const {
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,
} = require('./template.validator');
const {
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsQuerySchema,
  campaignIdParamSchema,
  executeCampaignSchema,
} = require('./campaign.validator');

module.exports = {
  validate,
  pagination,
  idParamSchema,
  queryBoolean,
  MAX_LIMIT,

  // auth
  forgotPasswordSchema,
  resetPasswordSchema,

  // message
  sendTextSchema,
  sendMediaSchema,
  listMessagesQuerySchema,
  messageParamSchema,

  // contact
  listContactsQuerySchema,
  contactParamSchema,

  // conversation
  listConversationsQuerySchema,
  conversationParamSchema,
  assignConversationBodySchema,

  // setting
  setSettingSchema,
  listSettingsQuerySchema,
  settingParamSchema,

  // admin
  retryOutgoingQuerySchema,
  listWebhookLogsQuerySchema,

  // template
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,

  // campaign
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsQuerySchema,
  campaignIdParamSchema,
  executeCampaignSchema,
};
