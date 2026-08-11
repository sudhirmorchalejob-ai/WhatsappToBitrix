const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { WEBHOOK_SOURCE } = require('../../constants');
const {
  InstallRepository,
  MessageRepository,
  WebhookLogRepository,
} = require('../../repositories');
const { ConversationService } = require('../conversation.service');
const { SmsConfigService, SMS_CONFIG_KEYS } = require('./config.service');
const { Bitrix24MessageProviderService } = require('../bitrix24/messageProvider.service');
const {
  extractProviderMessageId,
  mapProviderStatusToLocal,
  localToBitrix24,
} = require('./status');
const { verifyHmac, safeEqualStr } = require('../../middlewares/webhookAuth');

const log = logger.childFor('sms-delivery-webhook');

/**
 * Processes SMS gateway delivery reports (POST /webhooks/sms).
 *
 * The report carries the provider message id (MSG91 `msgid`, generic
 * `message_id`/`request_id`/`id`), which resolves the local Message row and
 * therefore the tenant. Status mapping (provider -> local -> Bitrix24):
 *
 *   delivered -> DELIVERED -> delivered
 *   undelivered/expired/rejected -> UNDELIVERED -> undelivered
 *   sent/accepted -> SENT -> sent
 *   failed/error -> FAILED -> failed
 *
 * Auth: when the tenant has an SMS_WEBHOOK_SECRET configured, the request
 * must match it (x-sms-secret / ?secret= / body.secret) or carry a valid
 * HMAC-SHA256 signature (x-sms-signature over the raw body). Without a
 * configured secret the webhook is accepted but logged as unverified.
 */
class SmsDeliveryService {
  constructor({
    messageRepo = new MessageRepository(),
    installRepo = new InstallRepository(),
    webhookLogRepo = new WebhookLogRepository(),
    conversationService = new ConversationService(),
    configService = new SmsConfigService(),
    messageProvider = new Bitrix24MessageProviderService(),
  } = {}) {
    this.messageRepo = messageRepo;
    this.installRepo = installRepo;
    this.webhookLogRepo = webhookLogRepo;
    this.conversationService = conversationService;
    this.configService = configService;
    this.messageProvider = messageProvider;
  }

  _rawStatus(obj) {
    if (!obj) return null;
    return obj.status || obj.deliveryStatus || obj.event || obj.dlr || obj.errorcode || obj.error_code || null;
  }

  _verify({ rawBody, body, query, headers, secret }) {
    if (!secret) return false;
    const token = headers['x-sms-secret'] || query.secret || body.secret;
    if (token && safeEqualStr(token, secret)) return true;
    if (rawBody && headers['x-sms-signature']) {
      return verifyHmac(rawBody, headers['x-sms-signature'], secret);
    }
    return false;
  }

  async handleDelivery({ rawBody = null, body = {}, query = {}, headers = {} } = {}) {
    const payload = body && typeof body === 'object' ? body : {};
    const queryPayload = query && typeof query === 'object' ? query : {};

    const providerMessageId = extractProviderMessageId(payload) || extractProviderMessageId(queryPayload);
    if (!providerMessageId) {
      throw new AppError('SMS delivery report is missing a message id', 400, null, 'MISSING_SMS_MESSAGE_ID');
    }

    const message = await this.messageRepo.findByProviderMessageId(providerMessageId);
    if (!message) {
      throw new AppError('Unknown SMS provider message id', 404, null, 'SMS_MESSAGE_NOT_FOUND');
    }
    if (String(message.provider || '').toUpperCase() !== 'SMS') {
      throw new AppError('Message is not an SMS message', 400, null, 'NOT_SMS_MESSAGE');
    }

    const tenantId = message.tenantId || null;

    const config = await this.configService.get(tenantId);
    const secret = config[SMS_CONFIG_KEYS.WEBHOOK_SECRET];
    const verified = secret ? this._verify({ rawBody, body: payload, query: queryPayload, headers, secret }) : false;
    if (secret && !verified) {
      throw new AppError('Invalid SMS webhook signature', 401, null, 'SMS_WEBHOOK_UNAUTHORIZED');
    }
    if (!secret) {
      log.warn('sms delivery webhook accepted without a configured SMS_WEBHOOK_SECRET', {
        messageId: message.id,
        tenantId,
      });
    }

    const rawStatus = this._rawStatus(payload) || this._rawStatus(queryPayload);
    const localStatus = mapProviderStatusToLocal(rawStatus);
    if (!localStatus) {
      throw new AppError('Unparseable SMS delivery status', 400, null, 'SMS_STATUS_UNKNOWN');
    }
    const error = payload.error || queryPayload.error || null;

    await this.conversationService.recordMessageStatus({
      messageId: message.id,
      status: localStatus,
      providerStatus: rawStatus ? String(rawStatus) : null,
      error: error ? String(error) : null,
      raw: payload,
      timestamp: new Date(),
    });

    const install = await this.installRepo.findByTenantId(tenantId).catch(() => null);
    if (install && message.bitrixMessageId) {
      const b24Status = localToBitrix24(localStatus);
      await this.messageProvider
        .updateMessageStatus(install.memberId, {
          messageId: message.bitrixMessageId,
          status: b24Status,
        })
        .then(() => {
          log.info('sms delivery reported to bitrix24', { messageId: message.id, status: b24Status });
        })
        .catch((err) => {
          log.warn('sms delivery status update to bitrix24 failed', {
            messageId: message.id,
            code: err.code,
            message: err.message,
          });
        });
    }

    await this.webhookLogRepo
      .create({
        source: WEBHOOK_SOURCE.SMS,
        tenantId,
        eventType: 'sms.delivery',
        payload,
        status: 'PROCESSED',
        signature: headers['x-sms-signature'] || null,
      })
      .catch(() => {});

    return { ok: true, messageId: message.id, status: localStatus, verified };
  }
}

module.exports = { SmsDeliveryService };
