const logger = require('../utils/logger');
const { env } = require('../config');
const { MESSAGE_TYPE, MESSAGE_STATUS, WEBHOOK_SOURCE, PROVIDER } = require('../constants');
const { MessageRepository, MessageStatusRepository, ActivityLogRepository } = require('../repositories');
const { CampaignRepository } = require('../repositories/campaign.repository');
const { WhatsBoxService } = require('../services/whatsbox');
const { SmsService, SmsConfigService } = require('../services/sms');
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
 * The send is provider-aware between WhatsApp (always the WhatsBox
 * gateway) and SMS: operator replies and campaign sends are retried over
 * the same WhatsApp gateway they were originally delivered through.
 */
class RetryOutgoingMessagesJob {
  constructor({
    messageRepo = new MessageRepository(),
    messageStatusRepo = new MessageStatusRepository(),
    whatsbox = new WhatsBoxService(),
    sms = new SmsService(),
    smsConfig = new SmsConfigService(),
    conversationService = new ConversationService(),
    activityLogRepo = null,
    campaignRepository = new CampaignRepository(),
    intervalMs = env.RETRY_INTERVAL_MS,
    maxRetries = env.OUTGOING_MAX_RETRIES,
  } = {}) {
    this.messageRepo = messageRepo;
    this.messageStatusRepo = messageStatusRepo;
    this.whatsbox = whatsbox;
    this.sms = sms;
    this.smsConfig = smsConfig;
    this.conversationService = conversationService;
    this.activityLogRepo = activityLogRepo;
    this.campaignRepository = campaignRepository;
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
    const smsConfigured = await this.smsConfig.isGloballyConfigured().catch(() => false);
    const anyProviderConfigured = Boolean(env.WHATSBOX_API_URL) || smsConfigured;
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
    const tenantId = message.tenantId || (message.conversation && message.conversation.tenantId) || null;
    await this._logActivity(tenantId, {
      action: 'MESSAGE_RETRY_STARTED',
      category: 'MESSAGE',
      details: { messageId: message.id, retryCount: message.retryCount + 1 },
    });

    try {
      const sendResult = await this._send(message);
      await this._backfillProviderId(message, sendResult);
      await this._recordAttempt(message, MESSAGE_STATUS.SENT, null, sendResult.raw);
      await this.messageRepo.updateStatus(message.id, MESSAGE_STATUS.SENT, { sentAt: new Date() });
      await this._syncCampaignRecipient(message);
      log.info('outgoing message re-sent', { messageId: message.id });
      await this._logActivity(tenantId, {
        action: 'MESSAGE_RETRY_SUCCEEDED',
        category: 'MESSAGE',
        details: { messageId: message.id },
      });
      return { messageId: message.id, ok: true };
    } catch (err) {
      const retryCount = message.retryCount + 1;
      const status = retryCount >= maxRetries ? MESSAGE_STATUS.FAILED : MESSAGE_STATUS.PENDING;
      await this.messageRepo.update(message.id, { retryCount, status, error: err.message });
      await this._recordAttempt(message, status, err.message, null);
      log.warn('retry attempt failed', { messageId: message.id, retryCount, status, error: err.message });
      if (status === MESSAGE_STATUS.FAILED) {
        await this._logActivity(tenantId, {
          action: 'MESSAGE_DELIVERY_FAILED',
          category: 'MESSAGE',
          details: { messageId: message.id, error: err.message },
        });
      }
      return { messageId: message.id, ok: false, error: err.message, retryCount };
    }
  }

  async _logActivity(tenantId, entry) {
    if (!this.activityLogRepo) return;
    try {
      await this.activityLogRepo.log({ tenantId, ...entry });
    } catch (err) {
      log.warn('activity log failed', { error: err.message });
    }
  }

  /**
   * Stores the provider id in the column matching the provider: the
   * WhatsBox message id for WhatsApp, or the SMS provider message id. The
   * whatsboxMessageId column stays reserved for the inbound dedup id, so
   * an operator reply's payload id (b24:...) is never clobbered.
   */
  async _backfillProviderId(message, result) {
    if (this._isSms(message)) {
      return this.conversationService.updateOutgoingMessageId({
        id: message.id,
        providerMessageId: result.providerMessageId || null,
      });
    }
    return this.conversationService.updateOutgoingMessageId({
      id: message.id,
      whatsboxMessageId: result.whatsboxMessageId || null,
    });
  }

  _isSms(message) {
    const provider = String(message.provider || (message.conversation && message.conversation.provider) || '')
      .toUpperCase();
    return provider === PROVIDER.SMS || provider === WEBHOOK_SOURCE.SMS;
  }

  async _send(message) {
    const to = message.conversation.contact.whatsappPhone;
    const isText = message.type === MESSAGE_TYPE.TEXT && Boolean(message.body);
    const mediaType = TYPE_TO_WHATSBOX[message.type];
    const channelId = message.conversation.channelNumber || env.WHATSBOX_CHANNEL_ID || undefined;

    if (this._isSms(message)) {
      if (!isText) {
        throw new AppError('Media messages cannot be retried via the SMS provider', 400, null, 'UNRETRIABLE_SMS_TYPE');
      }
      const tenantId = message.tenantId || (message.conversation && message.conversation.tenantId) || null;
      return this.sms.sendText(tenantId, { to, body: message.body });
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

  /**
   * A successfully re-sent campaign message flips the recipient row back
   * to SENT so the campaign's counters and reply matching stay accurate.
   * Best-effort: retry must never be blocked by campaign bookkeeping.
   */
  async _syncCampaignRecipient(message) {
    if (!message || !message.campaignId || !this.campaignRepository) return;
    try {
      await this.campaignRepository.updateRecipientFromMessage(message.id, {
        status: 'SENT',
        error: null,
        sentAt: new Date(),
      });
      await this.campaignRepository.syncCounters(message.campaignId);
    } catch (err) {
      log.warn('campaign recipient sync after retry failed', {
        messageId: message.id,
        campaignId: message.campaignId,
        code: err.code,
        message: err.message,
      });
    }
  }
}

module.exports = { RetryOutgoingMessagesJob, TYPE_TO_WHATSBOX };
