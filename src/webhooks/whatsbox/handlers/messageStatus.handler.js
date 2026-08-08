const logger = require('../../../utils/logger');
const { MESSAGE_DIRECTION, MESSAGE_STATUS } = require('../../../constants');
const { ConversationService } = require('../../../services/conversation.service');
const { MessageRepository } = require('../../../repositories');

const log = logger.childFor('webhook-status');

/**
 * Delivery / read / failed status orchestration.
 *
 * Provider callbacks reference the message by its provider id
 * (whatsboxMessageId or wamid). The handler resolves it to a local
 * message, then delegates the state transition + audit row to
 * ConversationService.recordMessageStatus (which enforces monotonic
 * transitions). Failed OUTGOING messages are left in a state the retry
 * job (src/jobs) picks up.
 */
class MessageStatusHandler {
  constructor({
    conversationService = new ConversationService(),
    messageRepo = new MessageRepository(),
  } = {}) {
    this.service = conversationService;
    this.messageRepo = messageRepo;
  }

  async handle(canonical) {
    if (!canonical || canonical.event !== 'status') {
      return { handled: false, skipped: true, reason: 'not-a-status-event' };
    }
    if (!canonical.status) {
      return { handled: false, skipped: true, reason: 'no-status' };
    }
    if (!canonical.messageId) {
      return { handled: false, skipped: true, reason: 'no-provider-message-id' };
    }

    const message = await this._findMessage(canonical.messageId);
    if (!message) {
      log.warn('status callback for unknown message', {
        providerMessageId: canonical.messageId,
        status: canonical.status,
      });
      return { handled: false, skipped: true, reason: 'message-not-found' };
    }

    const isFailure = canonical.status === MESSAGE_STATUS.FAILED;
    await this.service.recordMessageStatus({
      messageId: message.id,
      status: canonical.status,
      providerStatus: canonical.status,
      error: isFailure ? canonical.failedReason : null,
      raw: canonical.raw,
      timestamp: canonical.timestamp,
    });

    if (isFailure && message.direction === MESSAGE_DIRECTION.OUTGOING) {
      log.warn('outgoing message failed; retry job will pick it up', {
        messageId: message.id,
        reason: canonical.failedReason,
        retryCount: message.retryCount,
      });
    } else {
      log.info('message status updated', { messageId: message.id, status: canonical.status });
    }

    return { handled: true, messageId: message.id, status: canonical.status, direction: message.direction };
  }

  async _findMessage(providerMessageId) {
    const byId = await this.messageRepo.findByWhatsboxMessageId(providerMessageId);
    if (byId) return byId;
    return this.messageRepo.findByWamid(providerMessageId);
  }
}

module.exports = { MessageStatusHandler, defaultHandler: new MessageStatusHandler() };
