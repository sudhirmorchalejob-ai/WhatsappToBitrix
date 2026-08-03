const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { MESSAGE_DIRECTION, MESSAGE_STATUS, MESSAGE_TYPE } = require('../constants');
const { ConversationService } = require('./conversation.service');
const { CustomerResolverService } = require('./customerResolver.service');
const { WhatsBoxService } = require('./whatsbox');
const { MessageRepository, ConversationRepository } = require('../repositories');

const log = logger.childFor('outgoing-message-service');

/** WhatsBox media type -> local Message.type (symmetric to the retry job). */
const WHATSBOX_TO_DB_TYPE = Object.freeze({
  image: MESSAGE_TYPE.IMAGE,
  video: MESSAGE_TYPE.VIDEO,
  audio: MESSAGE_TYPE.AUDIO,
  document: MESSAGE_TYPE.DOCUMENT,
});

/**
 * Outgoing message orchestration used by the REST API.
 *
 * Contract: `to` is authoritative for the recipient. An optional
 * `conversationId` groups the message into an existing chat (the
 * conversation's contact is then used for CRM linkage); otherwise a
 * contact + conversation are resolved through the same find-or-create
 * rules as the inbound path, so both directions share one code path.
 *
 * Send policy: the message is always persisted first (never dropped).
 * A successful provider send advances it to SENT and backfills the
 * provider id; a failed send marks it FAILED so the retry job can pick
 * it up. The HTTP response carries the full row including `status` and
 * `error`, so callers can see the outcome without a separate lookup.
 */
class OutgoingMessageService {
  constructor({
    customerResolverService = null,
    conversationService = new ConversationService(),
    whatsbox = new WhatsBoxService(),
    messageRepo = new MessageRepository(),
    conversationRepo = new ConversationRepository(),
  } = {}) {
    this.service = conversationService;
    // Build from the same conversationService when not explicitly injected,
    // so existing tests that only pass conversationService continue to work.
    this.customerResolverService =
      customerResolverService || new CustomerResolverService({ conversationService });
    this.whatsbox = whatsbox;
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
  }

  async sendText(input) {
    const { conversation, messageContact } = await this._resolveContext(input);
    const dealId = await this._resolveDealId({ input, conversation, messageContact, firstBody: input.body });

    const message = await this.service.saveMessage({
      conversation,
      contact: messageContact,
      dealId,
      direction: MESSAGE_DIRECTION.OUTGOING,
      type: MESSAGE_TYPE.TEXT,
      body: input.body,
      status: MESSAGE_STATUS.PENDING,
    });

    try {
      const result = await this.whatsbox.sendText({
        to: messageContact.whatsappPhone,
        body: input.body,
        previewUrl: input.previewUrl,
        channelId: input.channelId,
        userId: input.userId,
        name: input.name,
      });
      await this._markSent(message.id, result);
    } catch (err) {
      await this._markFailed(message.id, err);
    }

    return this.messageRepo.findById(message.id);
  }

  async sendMedia(input) {
    const { conversation, messageContact } = await this._resolveContext(input);
    const type = this._toDbType(input);
    const dealId = await this._resolveDealId({ input, conversation, messageContact, firstBody: input.caption });

    const message = await this.service.saveMessage({
      conversation,
      contact: messageContact,
      dealId,
      direction: MESSAGE_DIRECTION.OUTGOING,
      type,
      body: null,
      caption: input.caption,
      mediaUrl: input.link,
      mediaName: input.filename,
      status: MESSAGE_STATUS.PENDING,
    });

    try {
      const result = await this.whatsbox.sendMedia({
        to: messageContact.whatsappPhone,
        type: input.type,
        link: input.link,
        caption: input.caption,
        filename: input.filename,
        channelId: input.channelId,
        userId: input.userId,
        name: input.name,
      });
      await this._markSent(message.id, result);
    } catch (err) {
      await this._markFailed(message.id, err);
    }

    return this.messageRepo.findById(message.id);
  }

  // ------------------------------------------------------------------
  // Shared resolution steps
  // ------------------------------------------------------------------

  /**
   * Resolves the contact + conversation for a send request.
   *
   * With a conversationId the existing chat (and its contact) is reused
   * and contact find-or-create is skipped entirely; otherwise the same
   * ensureContact -> ensureConversation rules as the inbound path apply.
   */
  async _resolveContext(input) {
    if (input.conversationId) {
      const conversation = await this.conversationRepo.findById(input.conversationId);
      if (!conversation) {
        throw new AppError('Conversation not found', 404, null, 'CONVERSATION_NOT_FOUND');
      }
      return { conversation, messageContact: conversation.contact };
    }

    const { contact, conversation } = await this.customerResolverService.resolveCustomer({
      phone: input.to,
      name: input.name,
      channelNumber: input.channelId || input.to,
    });
    return { conversation, messageContact: contact };
  }

  /**
   * Explicit dealId wins; otherwise reuse/search/create the open deal via
   * the shared orchestration. A missing open deal is non-fatal.
   */
  async _resolveDealId({ input, conversation, messageContact, firstBody }) {
    if (input.dealId) return Number(input.dealId);
    const result = await this.service.ensureOpenDeal({
      contact: messageContact,
      conversation,
      firstMessageBody: firstBody || null,
    });
    return result.deal ? Number(result.deal.ID) : null;
  }

  /** Maps the WhatsBox media type to the local Message.type (PDF-aware). */
  _toDbType(input) {
    const mapped = WHATSBOX_TO_DB_TYPE[input.type];
    if (!mapped) {
      throw new AppError(`Unsupported media type: ${input.type}`, 400, null, 'INVALID_MEDIA_TYPE');
    }
    if (input.type === 'document' && input.filename && /\.pdf$/i.test(input.filename)) {
      return MESSAGE_TYPE.PDF;
    }
    return mapped;
  }

  async _markSent(messageId, result) {
    await this.service.updateOutgoingMessageId({
      id: messageId,
      whatsboxMessageId: result.whatsboxMessageId || null,
    });
    await this.service.recordMessageStatus({ messageId, status: MESSAGE_STATUS.SENT });
    await this.messageRepo.updateStatus(messageId, MESSAGE_STATUS.SENT, { sentAt: new Date() });
  }

  async _markFailed(messageId, err) {
    log.warn('provider send failed; message marked FAILED for retry', {
      messageId,
      code: err.code,
      message: err.message,
    });
    await this.service.recordMessageStatus({
      messageId,
      status: MESSAGE_STATUS.FAILED,
      error: err.message,
    });
  }
}

module.exports = { OutgoingMessageService, WHATSBOX_TO_DB_TYPE };
