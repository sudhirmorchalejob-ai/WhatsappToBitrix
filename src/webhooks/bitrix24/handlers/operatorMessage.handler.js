const logger = require('../../../utils/logger');
const {
  MESSAGE_DIRECTION,
  MESSAGE_TYPE,
  MESSAGE_STATUS,
  BITRIX24_METHODS,
} = require('../../../constants');
const { mediaTypeFromMime } = require('../../../helpers/media');
const { ConversationService } = require('../../../services/conversation.service');
const { Bitrix24Service } = require('../../../services/bitrix24');
const { WhatsBoxService } = require('../../../services/whatsbox');
const { MetaService } = require('../../../services/meta');
const {
  MessageRepository,
  ConversationRepository,
  AgentRepository,
  ConversationAssignmentRepository,
  ActivityLogRepository,
} = require('../../../repositories');

const log = logger.childFor('webhook-b24-operator');

/**
 * Operator reply orchestration (Phase 4 + Phase 8 + Phase 9).
 *
 * Bitrix24 fires ONIMCONNECTORMESSAGEADD when an operator answers through
 * the custom connector. Each message carries:
 *   message.user_id - the Bitrix24 user who replied (maps to an agent)
 *   chat.id         - the external chat id we passed to
 *                     imconnector.send.messages (maps to a conversation)
 *   im.message_id   - the Bitrix24 message id (used for idempotency)
 *   message.files   - optional attachments (Phase 9): the first file is
 *                     sent as WhatsApp media with the text as caption
 *
 * Flow: dedup -> pin portal -> rotate tokens -> ensure agent -> link
 * conversation -> save OUTGOING message (PENDING) -> send the reply to
 * the customer over the conversation's WhatsApp provider -> advance the
 * message to SENT (or FAILED for the retry job) -> confirm delivery to
 * B24.
 *
 * Every B24/provider side-effect is defensive: a failure must never break
 * the webhook acknowledgement or lose the message.
 */
class OperatorMessageHandler {
  constructor({
    conversationService = new ConversationService(),
    messageRepo = new MessageRepository(),
    conversationRepo = new ConversationRepository(),
    agentRepo = new AgentRepository(),
    assignmentRepo = new ConversationAssignmentRepository(),
    activityLogRepo = new ActivityLogRepository(),
    bitrix24 = new Bitrix24Service(),
    whatsbox = new WhatsBoxService(),
    meta = new MetaService(),
  } = {}) {
    this.service = conversationService;
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
    this.agentRepo = agentRepo;
    this.assignmentRepo = assignmentRepo;
    this.activityLogRepo = activityLogRepo;
    this.bitrix24 = bitrix24;
    this.whatsbox = whatsbox;
    this.meta = meta;
  }

  async handle(canonical, { install, auth } = {}) {
    if (!canonical || canonical.event !== 'operatorMessage') {
      return { handled: false, skipped: true, reason: 'not-an-operator-message' };
    }

    // Idempotency: a re-delivered event for the same B24 message id is a
    // no-op (looked up via the payload.operatorReplyId JSON path, which
    // keeps the whatsboxMessageId/wamid columns free for the provider id
    // of the actual WhatsApp send).
    const providerId = this._providerId(canonical);
    if (providerId) {
      const existing = await this.messageRepo.findByOperatorReplyId(providerId);
      if (existing) {
        return { handled: true, skipped: true, reason: 'duplicate', b24MessageId: canonical.b24MessageId };
      }
    }

    const conversation = await this._findConversation(canonical);
    if (!conversation) {
      log.warn('operator reply for unknown chat', {
        externalChatId: canonical.externalChatId,
        b24MessageId: canonical.b24MessageId,
        memberId: canonical.memberId,
      });
      return { handled: false, skipped: true, reason: 'conversation-not-found' };
    }

    // Pin every subsequent REST call to this portal.
    this.bitrix24.activate(canonical.memberId);

    // The event auth carries a freshly issued access token; store it so
    // the delivery confirmation (and later sends) use valid credentials.
    await this._rotateTokens(install, auth).catch((err) =>
      log.warn('token rotation skipped', { memberId: canonical.memberId, code: err.code, message: err.message })
    );

    const agent = await this._ensureAgent(canonical.userId);
    if (!agent) {
      return { handled: false, skipped: true, reason: 'no-agent-user' };
    }

    if (conversation.assignedAgentId !== agent.id) {
      await this.conversationRepo.update(conversation.id, { assignedAgentId: agent.id });
      await this.assignmentRepo
        .assign({ conversationId: conversation.id, agentId: agent.id })
        .catch((err) => log.warn('assignment audit failed', { conversationId: conversation.id, error: err.message }));
    }

    // Persist first (the reply is never dropped), then deliver it.
    const content = this._buildContent(canonical);
    const message = await this.service.saveMessage({
      conversation,
      contact: conversation.contact,
      direction: MESSAGE_DIRECTION.OUTGOING,
      type: content.dbType,
      body: content.body,
      caption: content.caption,
      mediaUrl: content.mediaUrl,
      mediaMimeType: content.mediaMimeType,
      mediaName: content.mediaName,
      mediaSize: content.mediaSize,
      payload: providerId ? { operatorReplyId: providerId } : null,
      timestamp: canonical.timestamp,
      status: MESSAGE_STATUS.PENDING,
    });

    const send = await this._sendOperatorReply(conversation, content);
    if (send.ok) {
      await this.service.updateOutgoingMessageId({
        id: message.id,
        whatsboxMessageId: send.whatsboxMessageId || null,
        wamid: send.wamid || null,
      });
      await this.service.recordMessageStatus({
        messageId: message.id,
        status: MESSAGE_STATUS.SENT,
        providerStatus: send.provider,
        raw: send.raw,
      });
      await this.messageRepo.updateStatus(message.id, MESSAGE_STATUS.SENT, { sentAt: new Date() });
    } else {
      log.warn('operator reply send failed; message left for the retry job', {
        conversationId: conversation.id,
        messageId: message.id,
        provider: send.provider,
        reason: send.error,
      });
      await this.service.recordMessageStatus({
        messageId: message.id,
        status: MESSAGE_STATUS.FAILED,
        error: send.error,
      });
    }

    await this._confirmDelivery(canonical, message.id);

    log.info('operator reply processed', {
      conversationId: conversation.id,
      messageId: message.id,
      agentId: agent.id,
      provider: send.provider,
      type: content.dbType,
      media: Boolean(content.media),
      sent: send.ok,
      b24MessageId: canonical.b24MessageId,
    });

    if (this.activityLogRepo) {
      try {
        await this.activityLogRepo.log({
          tenantId: conversation.tenantId || null,
          userId: agent.id || null,
          action: 'OPERATOR_REPLY_SENT',
          category: 'MESSAGE',
          details: {
            messageId: message.id,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            b24MessageId: canonical.b24MessageId,
            text: (content.body || content.caption || '').slice(0, 200),
            sent: send.ok,
          },
        });
      } catch (err) {
        log.warn('operator reply activity log failed', { error: err.message });
      }
    }

    return {
      handled: true,
      conversationId: conversation.id,
      messageId: message.id,
      agentId: agent.id,
      providerId,
      provider: send.provider,
      type: content.dbType,
      sent: send.ok,
    };
  }

  /**
   * Resolves the conversation by externalChatId or conversation ID.
   */
  async _findConversation(canonical) {
    if (!canonical || !canonical.externalChatId) return null;

    const rawId = String(canonical.externalChatId);

    // 1. Match exact externalChatId stored on conversation
    const byExt = await this.conversationRepo.findByExternalChatId(rawId);
    if (byExt) return byExt;

    // 2. Match conversation ID (e.g. "conv_19" or "19")
    const match = rawId.match(/^(?:conv_)?(\d+)$/i);
    if (match) {
      const byId = await this.conversationRepo.findById(Number(match[1]));
      if (byId) return byId;
    }

    // 3. Match WhatsApp phone number (e.g. "wa_9988776655" or "9988776655")
    const digits = rawId.replace(/\D/g, '');
    if (digits && digits.length >= 7) {
      const contact = await this.service.contactRepo.findByWhatsappPhone(digits);
      if (contact) {
        const convs = await this.conversationRepo.findByContactId(contact.id);
        if (convs && convs.length) return convs[0];
      }
    }

    return null;
  }

  /**
   * Derives what to deliver to WhatsApp from the canonical event: the
   * primary attachment (mime-mapped to provider + DB type) plus the text
   * body. When an attachment is present the text becomes its caption,
   * mirroring the inbound media conventions.
   */
  _buildContent(canonical) {
    const text = canonical.text || null;
    const file = canonical.file || null;
    if (!file) {
      return {
        media: null,
        dbType: MESSAGE_TYPE.TEXT,
        body: text,
        caption: null,
        mediaUrl: null,
        mediaMimeType: null,
        mediaName: null,
        mediaSize: null,
      };
    }
    const { providerType, dbType } = mediaTypeFromMime(file.mimeType, file.name);
    return {
      media: {
        providerType,
        dbType,
        link: file.link || null,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      },
      dbType,
      body: null,
      caption: text,
      mediaUrl: file.link || null,
      mediaMimeType: file.mimeType || null,
      mediaName: file.name || null,
      mediaSize: file.size || null,
    };
  }

  /** Stable provider id across redeliveries: b24:{member}:{messageId}. */
  _providerId(canonical) {
    if (!canonical.b24MessageId) return null;
    return `b24:${canonical.memberId}:${canonical.b24MessageId}`;
  }

  /**
   * Sends the operator reply to the customer over the same WhatsApp
   * provider the customer's messages came in on (stored on the
   * conversation). Handles text and attachments: an attachment wins and
   * the text is sent as its caption. Never throws: any failure is
   * returned as { ok: false } so the message stays retryable and the
   * delivery confirmation to Bitrix24 still fires.
   */
  async _sendOperatorReply(conversation, content) {
    const to = conversation.contact && conversation.contact.whatsappPhone;
    if (!to) {
      return { ok: false, provider: 'NONE', error: 'contact-has-no-whatsapp-number' };
    }

    const provider = String(conversation.provider || 'WHATSBOX').toUpperCase();
    try {
      if (content.media) {
        if (!content.media.link) {
          return { ok: false, provider, error: 'attachment-has-no-download-link' };
        }
        const mediaInput = {
          to,
          type: content.media.providerType,
          link: content.media.link,
          caption: content.caption || undefined,
          filename: content.media.name || undefined,
        };
        if (provider === 'META') {
          const result = await this.meta.sendMedia({
            ...mediaInput,
            phoneNumberId: conversation.phoneNumberId || undefined,
          });
          return { ok: true, provider: 'META', wamid: result.wamid, raw: result.raw };
        }
        const result = await this.whatsbox.sendMedia({
          ...mediaInput,
          channelId: conversation.channelNumber || undefined,
        });
        return { ok: true, provider: 'WHATSBOX', whatsboxMessageId: result.whatsboxMessageId, raw: result.raw };
      }

      if (!content.body) {
        return { ok: false, provider: 'NONE', error: 'reply-has-no-sendable-content' };
      }
      if (provider === 'META') {
        const result = await this.meta.sendText({
          to,
          body: content.body,
          phoneNumberId: conversation.phoneNumberId || undefined,
        });
        return { ok: true, provider: 'META', wamid: result.wamid, raw: result.raw };
      }
      const result = await this.whatsbox.sendText({
        to,
        body: content.body,
        channelId: conversation.channelNumber || undefined,
      });
      return { ok: true, provider: 'WHATSBOX', whatsboxMessageId: result.whatsboxMessageId, raw: result.raw };
    } catch (err) {
      log.warn('operator reply provider send failed', {
        provider,
        media: Boolean(content.media),
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
      return { ok: false, provider, error: err.message };
    }
  }

  /**
   * Stores the access token from the event `auth` on the install row.
   * Best-effort: callers catch and log failures.
   */
  async _rotateTokens(install, auth = {}) {
    const accessToken = auth.access_token || auth.accessToken;
    if (!install || !install.memberId || !accessToken) return;
    const expiresIn = Number(auth.expires_in || auth.expiresIn || 3600);
    await this.bitrix24.installRepo.updateTokens(install.memberId, {
      accessToken,
      domain: auth.domain || install.domain,
      clientEndpoint: auth.client_endpoint || auth.clientEndpoint || install.clientEndpoint,
      scope: auth.scope || install.scope,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    });
  }

  /**
   * Finds the local agent mirror for a Bitrix24 user id, enriching the
   * cache from user.get on first sight. Falls back to a minimal row so
   * the operator reply is never dropped.
   */
  async _ensureAgent(userId) {
    if (!userId) return null;

    const known = await this.agentRepo.findByBitrix24Id(userId);
    if (known) return known;

    try {
      const users = await this.bitrix24.getUsers({ active: true, limit: 50 });
      const user = (users || []).find((u) => Number(u.ID || u.id) === Number(userId));
      if (user) return this.agentRepo.upsertFromBitrix24(user);
    } catch (err) {
      log.warn('user.get enrichment failed', { userId, code: err.code, message: err.message });
    }

    return this.agentRepo.upsertFromBitrix24({ ID: userId, NAME: `Agent ${userId}` });
  }

  /**
   * Confirms delivery of the operator message back to Bitrix24 with the
   * LOCAL message id (per the Open Channels connector contract). Failure
   * is logged, never propagated.
   */
  async _confirmDelivery(canonical, localMessageId) {
    try {
      await this.bitrix24.call(BITRIX24_METHODS.IMCONNECTOR_SEND_STATUS_DELIVERY, {
        CONNECTOR: canonical.connector,
        LINE: canonical.line,
        MESSAGES: [
          {
            im: { chat_id: canonical.b24ChatId, message_id: canonical.b24MessageId },
            message: { id: [localMessageId] },
            chat: { id: canonical.externalChatId },
          },
        ],
      });
    } catch (err) {
      log.warn('imconnector.send.status.delivery failed', {
        connector: canonical.connector,
        line: canonical.line,
        code: err.code,
        message: err.message,
      });
    }
  }
}

module.exports = { OperatorMessageHandler };
