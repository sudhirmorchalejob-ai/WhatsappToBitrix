const { ContactRepository } = require('./contact.repository');
const { ConversationRepository } = require('./conversation.repository');
const { MessageRepository } = require('./message.repository');
const { MessageStatusRepository } = require('./messageStatus.repository');
const { AgentRepository } = require('./agent.repository');
const { SettingRepository } = require('./setting.repository');
const { ConversationAssignmentRepository } = require('./conversationAssignment.repository');
const { WebhookLogRepository } = require('./webhookLog.repository');
const { InstallRepository } = require('./install.repository');
const { TemplateRepository } = require('./template.repository');
const { AutoReplyLogRepository } = require('./autoReplyLog.repository');
const { TenantRepository } = require('./tenant.repository');
const { UserRepository } = require('./user.repository');
const { ActivityLogRepository } = require('./activityLog.repository');
const { ConnectorLineMappingRepository } = require('./connectorLineMapping.repository');
const { CampaignRepository } = require('./campaign.repository');
const { WhatsAppTemplateRepository } = require('./whatsappTemplate.repository');

module.exports = {
  ContactRepository,
  ConversationRepository,
  MessageRepository,
  MessageStatusRepository,
  AgentRepository,
  SettingRepository,
  ConversationAssignmentRepository,
  WebhookLogRepository,
  InstallRepository,
  TemplateRepository,
  AutoReplyLogRepository,
  TenantRepository,
  UserRepository,
  ActivityLogRepository,
  ConnectorLineMappingRepository,
  CampaignRepository,
  WhatsAppTemplateRepository,
};
