const logger = require('../utils/logger');
const { SettingService } = require('./setting.service');
const { TemplateService } = require('./template.service');
const { OutgoingMessageService } = require('./outgoingMessage.service');
const { AutoReplyLogRepository } = require('../repositories');

const log = logger.childFor('auto-reply');

/**
 * Automatic replies (Phase 7).
 *
 * On an inbound customer message, decides whether to fire an automated
 * response. Control knobs live in DB settings:
 *   AUTO_REPLY_ENABLED            bool   (default false)
 *   AUTO_REPLY_BODY               string (literal override, rendered)
 *   AUTO_REPLY_TEMPLATE_ID        number (explicit template)
 *   AUTO_REPLY_ONCE_PER_CONTACT   bool   (default true — never spam)
 *   AUTO_REPLY_SKIP_ASSIGNED      bool   (default true — only when no
 *                                         operator owns the chat)
 *
 * Body resolution order: AUTO_REPLY_BODY -> AUTO_REPLY_TEMPLATE_ID ->
 * the active default template -> no reply. The reply is sent through the
 * normal outgoing path (so it is persisted, audited and retried) and a
 * row is written to auto_reply_logs. Never throws — a failure must not
 * break the inbound webhook acknowledgement.
 */
class AutoReplyService {
  constructor({
    settingService = new SettingService(),
    templateService = new TemplateService(),
    outgoingMessageService = new OutgoingMessageService(),
    autoReplyLogRepo = new AutoReplyLogRepository(),
  } = {}) {
    this.settingService = settingService;
    this.templateService = templateService;
    this.outgoingMessageService = outgoingMessageService;
    this.autoReplyLogRepo = autoReplyLogRepo;
  }

  async maybeReply({ conversation, contact }) {
    if (!conversation || !contact || !contact.id) {
      return { replied: false, reason: 'no-context' };
    }

    const enabled = await this.settingService.getValue('AUTO_REPLY_ENABLED', false);
    if (!enabled) return { replied: false, reason: 'disabled' };

    const skipAssigned = await this.settingService.getValue('AUTO_REPLY_SKIP_ASSIGNED', true);
    if (skipAssigned && conversation.assignedAgentId) {
      return { replied: false, reason: 'assigned' };
    }

    const oncePerContact = await this.settingService.getValue('AUTO_REPLY_ONCE_PER_CONTACT', true);
    const alreadyReplied = await this.autoReplyLogRepo.hasAutoReplied({
      contactId: contact.id,
      conversationId: conversation.id,
      oncePerContact,
    });
    if (alreadyReplied) return { replied: false, reason: 'already-replied' };

    const resolved = await this._resolveBody(contact);
    if (!resolved) return { replied: false, reason: 'no-template' };

    try {
      const message = await this.outgoingMessageService.sendText({
        to: contact.whatsappPhone,
        body: resolved.body,
        conversationId: conversation.id,
      });

      await this.autoReplyLogRepo.record({
        contactId: contact.id,
        conversationId: conversation.id,
        messageId: message.id,
        templateId: resolved.templateId || null,
        body: resolved.body,
      }).catch((err) => {
        log.warn('auto-reply audit log not written', { conversationId: conversation.id, message: err.message });
      });

      if (resolved.templateId) {
        await this.templateService.incrementUsage(resolved.templateId).catch((err) => {
          log.warn('template usage count not updated', { templateId: resolved.templateId, message: err.message });
        });
      }

      log.info('auto-reply sent', {
        conversationId: conversation.id,
        contactId: contact.id,
        messageId: message.id,
        templateId: resolved.templateId || null,
      });

      return { replied: true, messageId: message.id, templateId: resolved.templateId || null, body: resolved.body };
    } catch (err) {
      log.warn('auto-reply send failed', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
      return { replied: false, reason: 'send-failed' };
    }
  }

  async _resolveBody(contact) {
    const literal = await this.settingService.getValue('AUTO_REPLY_BODY', null);
    if (literal && String(literal).trim()) {
      return { body: this._render(contact, literal), templateId: null };
    }

    const templateId = await this.settingService.getValue('AUTO_REPLY_TEMPLATE_ID', null);
    if (templateId) {
      const template = await this.templateService.get(templateId).catch(() => null);
      if (template && template.isActive) {
        return { body: this._render(contact, template.body), templateId: template.id };
      }
    }

    const fallback = await this.templateService.findDefault();
    if (fallback) {
      return { body: this._render(contact, fallback.body), templateId: fallback.id };
    }

    return null;
  }

  _render(contact, body) {
    return this.templateService.render(body, {
      name: contact.name || contact.firstName || null,
      firstName: contact.firstName || null,
      lastName: contact.lastName || null,
      phone: contact.whatsappPhone || null,
    });
  }
}

module.exports = { AutoReplyService };
