const logger = require('../utils/logger');
const { env } = require('../config');
const { MESSAGE_TYPE, MESSAGE_STATUS, WEBHOOK_SOURCE } = require('../constants');
const { MessageRepository, MessageStatusRepository } = require('../repositories');
const { WhatsBoxService } = require('../services/whatsbox');
const { MetaService } = require('../services/meta');
const { ConversationService } = require('../services/conversation.service');
const AppError = require('../utils/AppError');

const log = logger.childFor('job:retry-outgoing');

/** DB message types -> provider media type for the send API. */
const TYPE_TO_WHATSBOX = Object.freeze({
  [MESSAGE_TYPE.IMAGE]: 'image',
  [MESSAGE_TYPE.VIDEO]: 'video',
  [MESSAGE_TYPE.AUDIO]: 'audio',
  [MESSAGE_TYPE.VOICE]: 'audio',
  [MESSAGE_TYPE.DOCUMENT]: 'document',
  [MESSAGE_TYPE.PDF]: 'document',
});

/**
 * Periodically re-sends outgoing messages that never reached a terminal
 * delivery state (PENDING/FAILED with a remaining retry budget). Each
 * failed attempt increments retryCount and re-records the message state;
 * once the budget is exhausted the message is marked FAILED permanently
 * and surfaced to the admin diagnostics endpoint instead of hammering
 * the provider.
 *
 * The send is provider-aware: the conversation's stored provider
 * (WHATSBOX/META) decides which service sends the message, so operator
 * replies are retried over the same WhatsApp provider they were
 * originally delivered through.
 */
class RetryOutgoingMessagesJob {
  constructor({
    messageRepo = new MessageRepository(),
    messageStatusRepo = new MessageStatusRepository(),
    whatsbox = new WhatsBoxService(),
    meta = new MetaService(),
    conversationService = new ConversationService(),
    intervalMs = env.RETRY_INTERVAL_MS,
    maxRetries = env.OUTGOING_MAX_RETRIES,
  } = {}) {
    this.messageRepo = messageRepo;
    this.messageStatusRepo = messageStatusRepo;
    this.whatsbox = whatsbox;
    this.meta = meta;
    this.conversationService = conversationService;
    this.intervalMs = intervalMs;
    this.maxRetries = maxRetries;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.run().catch((err) => log.error('retry run crashed', { error: err.message }));
    }, this.intervalMs);
    this.timer.unref();
    log.info('retry-outgoing job started', { intervalMs: this.intervalMs, maxRetries: this.maxRetries });
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  /**
   * Runs a single sweep over the retry backlog. The optional overrides
   * let the admin "retry now" endpoint bound a manual kick without
   * touching the job's scheduled configuration.
   */
  async run({ limit = 50, maxRetries = this.maxRetries, olderThanMinutes = 2 } = {}) {
    if (this.running) return { scanned: 0, skipped: true, reason: 'already-running' };
    // Never burn retry budget while every provider is simply unconfigured.
    const anyProviderConfigured = (env.WHATSBOX_API_URL && env.WHATSBOX_API_KEY) ||
      (env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID);
    if (!anyProviderConfigured) {
      return { scanned: 0, skipped: true, reason: 'no-provider-configured' };
    }

    this.running = true;
    try {
      const pending = await this.messageRepo.findPendingOutgoing({
        maxRetries,
        limit,
        olderThanMinutes,
      });

      const results = [];
      for (const message of pending) {
        results.push(await this._retryOne(message, maxRetries));
      }
      return { scanned: pending.length, results };
    } finally {
      this.running = false;
    }
  }

  async _retryOne(message, maxRetries = this.maxRetries) {
    try {
      const sendResult = await this._send(message);
      await this._backfillProviderId(message, sendResult);
      await this._recordAttempt(message, MESSAGE_STATUS.SENT, null, sendResult.raw);
      await this.messageRepo.updateStatus(message.id, MESSAGE_STATUS.SENT, { sentAt: new Date() });
      log.info('outgoing message re-sent', { messageId: message.id });
      return { messageId: message.id, ok: true };
    } catch (err) {
      const retryCount = message.retryCount + 1;
      const status = retryCount >= maxRetries ? MESSAGE_STATUS.FAILED : MESSAGE_STATUS.PENDING;
      await this.messageRepo.update(message.id, { retryCount, status, error: err.message });
      await this._recordAttempt(message, status, err.message, null);
      log.warn('retry attempt failed', { messageId: message.id, retryCount, status, error: err.message });
      return { messageId: message.id, ok: false, error: err.message, retryCount };
    }
  }

  /**
   * Stores the provider id in the column matching the provider: the Meta
   * wamid, or the WhatsBox message id. The whatsboxMessageId column stays
   * reserved for the inbound dedup id, so an operator reply's payload id
   * (b24:...) is never clobbered.
   */
  async _backfillProviderId(message, result) {
    if (this._isMeta(message)) {
      return this.conversationService.updateOutgoingMessageId({
        id: message.id,
        wamid: result.wamid || null,
      });
    }
    return this.conversationService.updateOutgoingMessageId({
      id: message.id,
      whatsboxMessageId: result.whatsboxMessageId || null,
    });
  }

  _isMeta(message) {
    return String(message.conversation.provider || WEBHOOK_SOURCE.WHATSBOX).toUpperCase() === WEBHOOK_SOURCE.META;
  }

  async _send(message) {
    const to = message.conversation.contact.whatsappPhone;
    const isText = message.type === MESSAGE_TYPE.TEXT && Boolean(message.body);
    const mediaType = TYPE_TO_WHATSBOX[message.type];
    const channelId = message.conversation.channelNumber || env.WHATSBOX_CHANNEL_ID || undefined;
    const phoneNumberId = message.conversation.phoneNumberId || env.META_PHONE_NUMBER_ID || undefined;

    if (this._isMeta(message)) {
      if (isText) return this.meta.sendText({ to, body: message.body, phoneNumberId });
      if (!mediaType) {
        throw new AppError('Message type cannot be retried via media API', 400, null, 'UNRETRIABLE_TYPE');
      }
      if (!message.mediaUrl) {
        throw new AppError('Media message has no mediaUrl to resend', 400, null, 'NO_MEDIA_URL');
      }
      return this.meta.sendMedia({
        to,
        type: mediaType,
        link: message.mediaUrl,
        caption: message.caption,
        filename: message.mediaName,
        phoneNumberId,
      });
    }

    if (isText) return this.whatsbox.sendText({ to, body: message.body, channelId });
    if (!mediaType) {
      throw new AppError('Message type cannot be retried via media API', 400, null, 'UNRETRIABLE_TYPE');
    }
    if (!message.mediaUrl) {
      throw new AppError('Media message has no mediaUrl to resend', 400, null, 'NO_MEDIA_URL');
    }
    return this.whatsbox.sendMedia({
      to,
      type: mediaType,
      link: message.mediaUrl,
      caption: message.caption,
      filename: message.mediaName,
      channelId,
    });
  }

  async _recordAttempt(message, status, error, raw) {
    return this.messageStatusRepo.create({
      messageId: message.id,
      status,
      providerStatus: 'RETRY',
      attempt: message.retryCount + 1,
      error,
      raw,
    });
  }
}

module.exports = { RetryOutgoingMessagesJob, TYPE_TO_WHATSBOX };
