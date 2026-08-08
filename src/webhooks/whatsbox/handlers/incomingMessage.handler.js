const logger = require('../../../utils/logger');
const { MESSAGE_DIRECTION, MESSAGE_STATUS, MESSAGE_TYPE, CONVERSATION_STATUS, WEBHOOK_SOURCE } = require('../../../constants');
const { ConversationService } = require('../../../services/conversation.service');
const { Bitrix24Service, Bitrix24ConnectorService } = require('../../../services/bitrix24');
const { RoutingService } = require('../../../services/routing.service');
const { AutoReplyService } = require('../../../services/autoReply.service');
const {
  MessageRepository,
  ConversationRepository,
  AgentRepository,
} = require('../../../repositories');

const { CustomerResolverService } = require('../../../services/customerResolver.service');

const log = logger.childFor('webhook-incoming');

/**
 * Human-readable labels used in CRM timeline comments and agent
 * notifications for non-text message types.
 */
const TYPE_LABELS = Object.freeze({
  [MESSAGE_TYPE.IMAGE]: 'Image',
  [MESSAGE_TYPE.VIDEO]: 'Video',
  [MESSAGE_TYPE.AUDIO]: 'Audio',
  [MESSAGE_TYPE.VOICE]: 'Voice note',
  [MESSAGE_TYPE.DOCUMENT]: 'Document',
  [MESSAGE_TYPE.PDF]: 'PDF',
  [MESSAGE_TYPE.STICKER]: 'Sticker',
  [MESSAGE_TYPE.LOCATION]: 'Location',
  [MESSAGE_TYPE.CONTACT]: 'Contact card',
});

/**
 * Incoming WhatsApp message orchestration (spec message flow):
 *
 *   webhook -> dedup -> resolve customer & lead (via CustomerResolverService)
 *   -> reopen closed chat -> externalChatId -> operator routing ->
 *   save message -> CRM timeline -> notify agent -> auto-reply
 *
 * Every CRM side-effect is defensive: a Bitrix24 failure must never
 * break the webhook response or lose the message. The handler is a class
 * with full dependency injection so tests can pass fakes for each piece.
 *
 * CustomerResolverService is the single entry-point for all
 * find-or-create logic (Contact, Conversation, Deal) ensuring no
 * duplicates are created regardless of which workflow triggers this path.
 */
class IncomingMessageHandler {
  constructor({
    customerResolverService = null,
    conversationService = new ConversationService(),
    messageRepo = new MessageRepository(),
    conversationRepo = new ConversationRepository(),
    agentRepo = new AgentRepository(),
    bitrix24 = new Bitrix24Service(),
    connectorService = new Bitrix24ConnectorService(),
    routingService = new RoutingService(),
    autoReplyService = new AutoReplyService(),
  } = {}) {
    this.service = conversationService;
    // If no customerResolverService is explicitly injected (e.g. in tests
    // that only pass conversationService), build one from the same instance
    // so all find-or-create logic is consistently routed through the service
    // that the caller provided.
    this.customerResolverService =
      customerResolverService || new CustomerResolverService({ conversationService });
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
    this.agentRepo = agentRepo;
    this.bitrix24 = bitrix24;
    this.connectorService = connectorService;
    this.routingService = routingService;
    this.autoReplyService = autoReplyService;
  }

  async handle(canonical) {
    if (!canonical || canonical.event !== 'message') {
      return { handled: false, skipped: true, reason: 'not-a-message-event' };
    }

    if (!canonical.from) {
      log.warn('incoming message without a sender phone', { messageId: canonical.messageId });
      return { handled: false, skipped: true, reason: 'no-sender-phone' };
    }

    // Idempotency: a re-delivered webhook for the same provider id is a
    // no-op (whatsboxMessageId is unique in the DB).
    if (canonical.messageId) {
      const existing = await this.messageRepo.findByWhatsboxMessageId(canonical.messageId);
      if (existing) {
        log.info('duplicate incoming message skipped', { messageId: canonical.messageId, dbId: existing.id });
        return { handled: true, skipped: true, reason: 'duplicate', messageId: canonical.messageId };
      }
    }

    const contactData = this._buildContact(canonical);
    const { contact, conversation, deal } = await this.customerResolverService.resolveCustomerAndLead({
      phone: contactData.phone,
      name: contactData.name,
      firstName: contactData.firstName,
      email: contactData.email,
      company: contactData.company,
      channelNumber: canonical.channelId,
      provider: canonical.provider || WEBHOOK_SOURCE.WHATSBOX,
      phoneNumberId: canonical.phoneNumberId || null,
      firstMessageBody: canonical.body,
    });

    // New activity on a closed conversation reopens it.
    if (conversation.status === CONVERSATION_STATUS.CLOSED) {
      await this.conversationRepo.reopen(conversation.id);
      conversation.status = CONVERSATION_STATUS.OPEN;
    }

    // The Open Channels external chat id must be stable before the first
    // forward: Bitrix24 echoes it back as chat.id on operator replies.
    conversation.bitrix24ExternalChatId = await this._ensureExternalChatId(conversation);

    // Auto-route the chat to an operator when it has none yet.
    await this._ensureAssigned(conversation, contact);

    const message = await this.service.saveMessage({
      conversation,
      contact,
      dealId: deal ? Number(deal.ID) : null,
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

    await this._forwardToOpenLine(conversation, contact, message, canonical);
    await this._postToCrm(contact, deal, canonical);
    await this._notifyAssignedAgent(conversation, contact, canonical);
    await this._autoReply(conversation, contact);

    log.info('incoming message processed', {
      messageId: message.id,
      providerMessageId: canonical.messageId,
      contactId: contact.id,
      conversationId: conversation.id,
      dealId: deal ? Number(deal.ID) : null,
      type: canonical.type,
    });

    return {
      handled: true,
      messageId: message.id,
      contactId: contact.id,
      conversationId: conversation.id,
      dealId: deal ? Number(deal.ID) : null,
    };
  }

  // ------------------------------------------------------------------
  // Contact input
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Open Channels forwarding
  // ------------------------------------------------------------------

  /**
   * Ensures the conversation has a stable bitrix24ExternalChatId (the
   * `chat.id` we pass to imconnector.send.messages). Persisted on first
   * sight; DB failures are non-fatal (forwarding is skipped, message kept).
   */
  async _ensureExternalChatId(conversation) {
    if (conversation.bitrix24ExternalChatId) return conversation.bitrix24ExternalChatId;

    const externalChatId = this._generateExternalChatId(conversation);
    try {
      await this.conversationRepo.update(conversation.id, { bitrix24ExternalChatId: externalChatId });
      return externalChatId;
    } catch (err) {
      log.warn('could not persist external chat id', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
      return null;
    }
  }

  _generateExternalChatId(conversation) {
    return `wa_${conversation.id}`;
  }

  /**
   * Forwards the customer message into the Bitrix24 open line so
   * operators see it in the Contact Center. Best-effort: a missing line
   * or a B24 failure must never break the webhook acknowledgement.
   */
  async _forwardToOpenLine(conversation, contact, message, canonical) {
    const externalChatId = conversation.bitrix24ExternalChatId;
    if (!externalChatId) return;

    try {
      const result = await this.connectorService.sendCustomerMessage({
        chatId: externalChatId,
        contactName: this._contactLabel(contact),
        messageId: message.id,
        body: this._describeMessage(canonical),
        date: canonical.timestamp,
      });
      if (!result.sent) {
        log.warn('incoming message not forwarded to open line', {
          conversationId: conversation.id,
          messageId: message.id,
          reason: result.skipped,
        });
      }
    } catch (err) {
      log.warn('imconnector.send.messages failed', {
        conversationId: conversation.id,
        messageId: message.id,
        code: err.code,
        message: err.message,
      });
    }
  }

  // ------------------------------------------------------------------
  // CRM timeline
  // ------------------------------------------------------------------

  /**
   * Writes the chat entry onto the deal timeline (falls back to the
   * contact when no deal exists). Failure is logged, never propagated.
   */
  async _postToCrm(contact, deal, canonical) {
    const entityType = deal && deal.ID ? 'deal' : 'contact';
    const entityId = deal && deal.ID ? Number(deal.ID) : contact.bitrix24ContactId;
    if (!entityId) return;

    const comment = this._buildTimelineComment(canonical);
    try {
      await this.bitrix24.createTimelineComment({ entityType, entityId, comment });
    } catch (err) {
      log.warn('CRM timeline comment failed', { entityType, entityId, code: err.code, message: err.message });
    }
  }

  _buildTimelineComment(canonical) {
    const fromLabel = canonical.from ? `+${canonical.from}` : 'unknown';
    const content = this._describeMessage(canonical);
    return `WhatsApp (inbound) from ${fromLabel}:\n${content}`.slice(0, 5000);
  }

  /**
   * Human-readable summary of a message for the CRM timeline, keeping
   * the media URL clickable so agents can open attachments.
   */
  _describeMessage(canonical) {
    if (canonical.type === MESSAGE_TYPE.TEXT) {
      return canonical.body || '(empty message)';
    }
    if (canonical.type === MESSAGE_TYPE.LOCATION) {
      const loc = canonical.locationData || {};
      const parts = [loc.name, loc.address, loc.lat != null && loc.lng != null ? `${loc.lat}, ${loc.lng}` : null]
        .filter(Boolean);
      return parts.length ? `Location: ${parts.join(' | ')}` : '(location)';
    }
    if (canonical.type === MESSAGE_TYPE.CONTACT) {
      const card = canonical.contactCard || {};
      const parts = [card.name, (card.phones || []).join(', '), card.email].filter(Boolean);
      return parts.length ? `Contact card: ${parts.join(' | ')}` : '(contact card)';
    }
    const label = TYPE_LABELS[canonical.type] || canonical.type || 'Message';
    const meta = [canonical.caption, canonical.mediaName].filter(Boolean).join(' — ');
    const url = canonical.mediaUrl ? `\n${canonical.mediaUrl}` : '';
    return `${label}${meta ? `: ${meta}` : ''}${url}`;
  }

  // ------------------------------------------------------------------
  // Operator routing
  // ------------------------------------------------------------------

  /**
   * Routes an unassigned conversation to an operator. Best-effort: a
   * routing failure must never drop the WhatsApp message, so it falls
   * back to leaving the conversation unassigned. On success the
   * conversation's assignedAgentId is set in memory so the later agent
   * notification fires.
   */
  async _ensureAssigned(conversation, contact) {
    if (!this.routingService) return;
    if (conversation.assignedAgentId) return;

    try {
      const result = await this.routingService.assignIfNeeded({ conversation, contact });
      if (result && result.assigned && result.agentId) {
        conversation.assignedAgentId = result.agentId;
        log.info('conversation auto-routed', {
          conversationId: conversation.id,
          agentId: result.agentId,
          reason: result.reason,
        });
      } else {
        log.info('conversation not routed', {
          conversationId: conversation.id,
          reason: result && result.reason,
        });
      }
    } catch (err) {
      log.warn('conversation routing failed', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
    }
  }

  // ------------------------------------------------------------------
  // Automatic reply
  // ------------------------------------------------------------------

  /**
   * Fires the automated response when configured. Best-effort: a failure
   * must never break the webhook acknowledgement of the customer message.
   */
  async _autoReply(conversation, contact) {
    if (!this.autoReplyService) return;

    try {
      const result = await this.autoReplyService.maybeReply({ conversation, contact });
      if (result.replied) {
        log.info('automatic reply queued', {
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

  // ------------------------------------------------------------------
  // Agent notification
  // ------------------------------------------------------------------

  /**
   * Informs the assigned agent of a new customer message via Bitrix24
   * push notification. Silently skipped when unassigned or on failure.
   */
  async _notifyAssignedAgent(conversation, contact, canonical) {
    if (!conversation.assignedAgentId) return;

    const agent = await this.agentRepo.findById(conversation.assignedAgentId).catch(() => null);
    if (!agent || !agent.bitrix24UserId) return;

    const preview = (canonical.body || canonical.caption || canonical.mediaName || this._typeLabel(canonical.type) || '(message)')
      .slice(0, 250);

    try {
      await this.bitrix24.notifyUser({
        toUserId: agent.bitrix24UserId,
        message: `New WhatsApp message from ${this._contactLabel(contact)}: ${preview}`,
        type: 'USER',
      });
    } catch (err) {
      log.warn('agent notification failed', { agentId: agent.id, code: err.code, message: err.message });
    }
  }

  _contactLabel(contact) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    return name || `+${contact.whatsappPhone}`;
  }

  _typeLabel(type) {
    return TYPE_LABELS[type] || null;
  }
}

module.exports = { IncomingMessageHandler, defaultHandler: new IncomingMessageHandler() };
