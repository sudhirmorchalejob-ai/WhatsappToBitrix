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
};
