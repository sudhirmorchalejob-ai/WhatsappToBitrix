const logger = require('../../../utils/logger');
const { MESSAGE_DIRECTION, MESSAGE_STATUS, CONVERSATION_STATUS, WEBHOOK_SOURCE } = require('../../../constants');
const { ConversationService } = require('../../../services/conversation.service');
const { AutoReplyService } = require('../../../services/autoReply.service');
const {
  MessageRepository,
  ConversationRepository,
  ActivityLogRepository,
} = require('../../../repositories');

const { CustomerResolverService } = require('../../../services/customerResolver.service');
const { Bitrix24ConnectorService } = require('../../../services/bitrix24');

const log = logger.childFor('webhook-incoming');

/**
 * Incoming WhatsApp message handler.
 *
 * Flow:
 *   webhook -> dedup -> resolve contact & create/reuse Bitrix24 lead
 *   -> reopen closed chat -> save message -> forward to Bitrix24 Open Channels -> auto-reply
 */
class IncomingMessageHandler {
  constructor({
    customerResolverService = null,
    conversationService = new ConversationService(),
    connectorService = new Bitrix24ConnectorService(),
    messageRepo = new MessageRepository(),
    conversationRepo = new ConversationRepository(),
    activityLogRepo = null,
    autoReplyService = new AutoReplyService(),
  } = {}) {
    this.service = conversationService;
    // If no customerResolverService is explicitly injected (e.g. in tests
    // that only pass conversationService), build one from the same instance
    // so all find-or-create logic is consistently routed through the service
    // that the caller provided.
    this.customerResolverService =
      customerResolverService || new CustomerResolverService({ conversationService });
    this.connectorService = connectorService;
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
    this.activityLogRepo = activityLogRepo;
    this.autoReplyService = autoReplyService;
  }

  async handle(canonical, context = {}) {
    if (!canonical || canonical.event !== 'message') {
      return { handled: false, skipped: true, reason: 'not-a-message-event' };
    }

    if (!canonical.from) {
      log.warn('incoming message without a sender phone', { messageId: canonical.messageId });
      return { handled: false, skipped: true, reason: 'no-sender-phone' };
    }

    const tenantId = (context && context.tenantId) || null;

    // Idempotency: a re-delivered webhook for the same provider id is a
    // no-op (whatsboxMessageId is unique in the DB).
    if (canonical.messageId) {
      const existing = await this.messageRepo.findByWhatsboxMessageId(canonical.messageId);
      if (existing) {
        log.info('duplicate incoming message skipped', { messageId: canonical.messageId, dbId: existing.id });
        return { handled: true, skipped: true, reason: 'duplicate', messageId: canonical.messageId };
      }
    }

    // Step 1: Resolve contact locally + in Bitrix24, and create/reuse the Bitrix24 lead.
    const contactData = this._buildContact(canonical);
    const { contact, conversation, lead, contactCreated, leadCreated } =
      await this.customerResolverService.resolveCustomerAndLead({
        phone: contactData.phone,
        name: contactData.name,
        firstName: contactData.firstName,
        email: contactData.email,
        company: contactData.company,
        channelNumber: canonical.channelId,
        provider: canonical.provider || WEBHOOK_SOURCE.WHATSBOX,
        phoneNumberId: canonical.phoneNumberId || null,
        firstMessageBody: canonical.body,
        tenantId,
      });

    log.info('customer resolved', {
      contactId: contact.id,
      created: contactCreated,
      phone: contactData.phone,
      tenantId,
    });
    log.info('lead resolved', {
      leadId: lead ? Number(lead.ID) : null,
      created: leadCreated,
      contactId: contact.id,
      tenantId,
    });

    await this._logActivity(tenantId, {
      action: contactCreated ? 'CUSTOMER_CREATED' : 'CUSTOMER_UPDATED',
      category: 'CRM',
      details: { contactId: contact.id, phone: contactData.phone, name: contactData.name },
      ipAddress: context.ip || null,
    });
    if (lead) {
      await this._logActivity(tenantId, {
        action: leadCreated ? 'LEAD_CREATED' : 'LEAD_REUSED',
        category: 'CRM',
        details: {
          contactId: contact.id,
          conversationId: conversation.id,
          leadId: Number(lead.ID),
        },
        ipAddress: context.ip || null,
      });
    }

    // Step 2: New activity on a closed conversation reopens it.
    if (conversation.status === CONVERSATION_STATUS.CLOSED) {
      await this.conversationRepo.reopen(conversation.id);
      conversation.status = CONVERSATION_STATUS.OPEN;
    }

    // Step 3: Save the message locally.
    const message = await this.service.saveMessage({
      conversation,
      contact,
      leadId: lead ? Number(lead.ID) : null,
      direction: MESSAGE_DIRECTION.INCOMING,
      type: canonical.type,
      body: canonical.body,
      caption: canonical.caption,
      mediaUrl: canonical.mediaUrl,
      mediaMimeType: canonical.mediaMimeType,
      mediaName: canonical.mediaName,
      mediaSize: canonical.mediaSize,
      locationData: canonical.locationData,
      contactCard: canonical.contactCard,
      whatsboxMessageId: canonical.messageId,
      timestamp: canonical.timestamp,
      status: MESSAGE_STATUS.SENT,
    });

    // Step 3.5: Forward customer WhatsApp message to Bitrix24 Open Channels (imconnector.send.messages)
    if (this.connectorService) {
      try {
        const chatId = contact.whatsappPhone ? `wa_${contact.whatsappPhone}` : `conv_${conversation.id}`;
        const contactName = contact.name || contact.firstName || (contact.whatsappPhone ? `+${contact.whatsappPhone}` : 'WhatsApp Customer');
        const openlineRes = await this.connectorService.sendCustomerMessage({
          chatId,
          contactName,
          messageId: canonical.messageId || `msg_${message.id}`,
          body: canonical.body || canonical.caption || '',
          date: canonical.timestamp ? new Date(canonical.timestamp * 1000) : new Date(),
        });
        log.info('forwarded incoming message to Bitrix24 Open Channels', { chatId, openlineRes });
      } catch (err) {
        log.error('failed to forward incoming message to Bitrix24 Open Channels', {
          error: err.message,
          code: err.code,
          contactId: contact.id,
        });
      }
    }

    // Step 4: Auto-reply (if enabled in settings). Auto-reply also calls
    // ensureOpenLead internally via OutgoingMessageService, so the same
    // lead is reused — no duplicate is ever created.
    await this._autoReply(conversation, contact);

    await this._logActivity(tenantId, {
      action: 'MESSAGE_RECEIVED',
      category: 'MESSAGE',
      details: {
        messageId: message.id,
        contactId: contact.id,
        conversationId: conversation.id,
        leadId: lead ? Number(lead.ID) : null,
        type: canonical.type,
        preview: (canonical.body || canonical.caption || '').slice(0, 200),
      },
      ipAddress: context.ip || null,
    });

    log.info('incoming message processed', {
      messageId: message.id,
      providerMessageId: canonical.messageId,
      contactId: contact.id,
      conversationId: conversation.id,
      leadId: lead ? Number(lead.ID) : null,
      type: canonical.type,
    });

    return {
      handled: true,
      messageId: message.id,
      contactId: contact.id,
      conversationId: conversation.id,
      leadId: lead ? Number(lead.ID) : null,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Best-effort audit trail entry. A failing activity log must
   * never break webhook processing.
   */
  async _logActivity(tenantId, entry) {
    if (!this.activityLogRepo) return;
    try {
      await this.activityLogRepo.log({ tenantId, ...entry });
    } catch (err) {
      log.warn('activity log failed', { error: err.message });
    }
  }

  /**
   * Derives contact fields from the webhook. `fromName` (WhatsApp
   * display name) is preferred; a contact-card payload can supply a
   * better name and an email.
   */
  _buildContact(canonical) {
    const card = canonical.contactCard || null;
    const name = canonical.fromName || (card && card.name) || null;
    return {
      phone: canonical.from,
      name,
      firstName: name,
      email: (card && card.email) || null,
      company: null,
    };
  }

  /**
   * Fires the automated response when configured in settings.
   * Best-effort: a failure must never break the webhook acknowledgement
   * of the customer message.
   */
  async _autoReply(conversation, contact) {
    if (!this.autoReplyService) return;

    try {
      const result = await this.autoReplyService.maybeReply({ conversation, contact });
      if (result.replied) {
        log.info('automatic reply sent', {
          conversationId: conversation.id,
          contactId: contact.id,
          messageId: result.messageId,
        });
      }
    } catch (err) {
      log.warn('auto-reply failed', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
    }
  }
}

module.exports = {
  IncomingMessageHandler,
  defaultHandler: new IncomingMessageHandler({ activityLogRepo: new ActivityLogRepository() }),
};
