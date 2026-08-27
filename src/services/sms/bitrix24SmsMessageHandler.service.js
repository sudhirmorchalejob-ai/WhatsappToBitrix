const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const {
  MESSAGE_DIRECTION,
  MESSAGE_TYPE,
  MESSAGE_STATUS,
  PROVIDER,
  WEBHOOK_SOURCE,
} = require('../../constants');
const {
  InstallRepository,
  MessageRepository,
  MessageStatusRepository,
  WebhookLogRepository,
} = require('../../repositories');
const { ConversationService } = require('../conversation.service');
const { SmsService } = require('./sms.service');
const { Bitrix24MessageProviderService } = require('../bitrix24/messageProvider.service');
const { WhatsAppTemplateService } = require('../whatsappTemplate.service');
const { bitrix24SmsSchema } = require('../../webhooks/bitrix24Sms/schemas');

const log = logger.childFor('bitrix24-sms-handler');

/**
 * Handles incoming message-send requests from Bitrix24 (the SMS provider
 * HANDLER callback). The flow is persist-first:
 *
 *   1. validate the payload and resolve the install via the provider code
 *   2. persist the message (direction OUTGOING, provider SMS, PENDING)
 *   3. send through the tenant's SMS gateway
 *   4. record SENT + providerMessageId, then report `sent` to Bitrix24
 *   5. on failure record FAILED and report `failed` to Bitrix24
 *
 * Bitrix24 does not define a strict response contract for the handler, so
 * we always answer 200 with a small JSON status; errors are logged and
 * reflected via messageservice.message.status.update.
 */
class Bitrix24SmsMessageHandler {
  constructor({
    installRepo = new InstallRepository(),
    messageRepo = new MessageRepository(),
    messageStatusRepo = new MessageStatusRepository(),
    webhookLogRepo = new WebhookLogRepository(),
    conversationService = new ConversationService(),
    smsService = new SmsService(),
    messageProvider = new Bitrix24MessageProviderService(),
    whatsappTemplateService = new WhatsAppTemplateService(),
  } = {}) {
    this.installRepo = installRepo;
    this.messageRepo = messageRepo;
    this.messageStatusRepo = messageStatusRepo;
    this.webhookLogRepo = webhookLogRepo;
    this.conversationService = conversationService;
    this.smsService = smsService;
    this.messageProvider = messageProvider;
    this.whatsappTemplateService = whatsappTemplateService;
  }

  /** Payload → resolved install (null when the code is unknown). */
  async _resolveInstall(payload) {
    const install = await this.messageProvider.resolveInstallByCode(payload.code).catch(() => null);
    if (!install || install.status !== 'INSTALLED') return null;
    return install;
  }

  async handleIncoming(payload) {
    const parsed = bitrix24SmsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('Invalid Bitrix24 SMS provider payload', 400, parsed.error.flatten(), 'INVALID_SMS_PAYLOAD');
    }
    const data = parsed.data;

    const install = await this._resolveInstall(data);
    if (!install) {
      throw new AppError(`Unknown message provider code: ${data.code}`, 400, null, 'UNKNOWN_PROVIDER_CODE');
    }
    const tenantId = install.tenantId || null;

    // Default template fallback: when message_body is empty, try to resolve
    // a default WhatsApp template for the tenant. This lets Bitrix24 trigger
    // pre-approved template sends via the SMS provider handler.
    let messageBody = data.message_body;
    if (!messageBody && tenantId) {
      const defaultTemplate = await this._resolveDefaultTemplate(tenantId);
      if (defaultTemplate) {
        messageBody = `[Template: ${defaultTemplate.templateName}]`;
        log.info(`[Bitrix24 SMS Handler] Using default template "${defaultTemplate.templateName}" for tenant ${tenantId}`);
      }
    }

    await this.webhookLogRepo.create({
      source: WEBHOOK_SOURCE.SMS,
      tenantId,
      eventType: 'messageservice.send',
      payload: data,
      status: 'RECEIVED',
    }).catch(() => {});

    // Dedup: message_id is Bitrix24's unique id for the send.
    const existing = await this.messageRepo.findByBitrixMessageId(data.message_id, tenantId).catch(() => null);
    if (existing) {
      return { ok: true, deduplicated: true, messageId: existing.id, status: existing.status };
    }

    const timestamp = this._toDate(data.ts || data.timestamp);

    const { contact } = await this.conversationService.ensureContact({
      phone: data.message_to,
      tenantId,
    });
    const { conversation } = await this.conversationService.ensureConversation({
      contactId: contact.id,
      channelNumber: 'SMS',
      provider: WEBHOOK_SOURCE.SMS,
      tenantId,
    });

    const message = await this.conversationService.saveMessage({
      conversation,
      contact,
      direction: MESSAGE_DIRECTION.OUTGOING,
      type: MESSAGE_TYPE.TEXT,
      body: messageBody,
      provider: PROVIDER.SMS,
      bitrixMessageId: data.message_id,
      payload: data,
      timestamp,
      status: MESSAGE_STATUS.PENDING,
      tenantId,
    });

    let sendResult;
    try {
      sendResult = await this.smsService.sendText(tenantId, {
        to: data.message_to,
        body: messageBody,
      });
    } catch (err) {
      const error = err && err.message ? err.message : String(err);
      await this.messageRepo.update(message.id, { status: MESSAGE_STATUS.FAILED, error });
      await this.messageStatusRepo.create({
        messageId: message.id,
        status: MESSAGE_STATUS.FAILED,
        providerStatus: 'local-error',
        attempt: 1,
        error,
      });
      await this._reportToBitrix24(install, data.message_id, 'failed').catch(() => {});
      return { ok: true, status: 'failed', messageId: message.id, error };
    }

    await this.messageRepo.update(message.id, {
      status: MESSAGE_STATUS.SENT,
      sentAt: new Date(),
      providerMessageId: sendResult.providerMessageId || null,
    });
    await this.messageStatusRepo.create({
      messageId: message.id,
      status: MESSAGE_STATUS.SENT,
      providerStatus: 'sent',
      attempt: 1,
      raw: sendResult.raw,
    });

    // Hand-off succeeded: Bitrix24 shows `sent` immediately; the delivery
    // webhook later flips it to delivered/undelivered/failed.
    await this._reportToBitrix24(install, data.message_id, 'sent').catch(() => {});

    return {
      ok: true,
      status: 'sent',
      messageId: message.id,
      providerMessageId: sendResult.providerMessageId || null,
    };
  }

  /** Best-effort messageservice.message.status.update call. */
  async _reportToBitrix24(install, messageId, status) {
    if (!install || !messageId) return;
    await this.messageProvider.updateMessageStatus(install.memberId, { messageId, status });
  }

  /**
   * Resolves a default WhatsApp template for the tenant. Looks for the
   * first ACTIVE MARKETING template, then UTILITY, then any. Returns null
   * when no templates are cached for the tenant.
   */
  async _resolveDefaultTemplate(tenantId) {
    try {
      const { items } = await this.whatsappTemplateService.list(tenantId, { status: 'ACTIVE', limit: 100 });
      if (!items.length) return null;
      // Prefer MARKETING > UTILITY > AUTHENTICATION > any
      const byCategory = (cat) => items.find((t) => t.category === cat);
      return byCategory('MARKETING') || byCategory('UTILITY') || byCategory('AUTHENTICATION') || items[0];
    } catch {
      return null;
    }
  }

  _toDate(value) {
    if (!value) return new Date();
    const n = Number(value);
    if (!Number.isNaN(n)) {
      // Bitrix24 ts is in seconds; a 13-digit value is already ms.
      return new Date(n > 1e12 ? n : n * 1000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
}

module.exports = { Bitrix24SmsMessageHandler };
