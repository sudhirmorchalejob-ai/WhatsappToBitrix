const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { SmsConfigService, SMS_CONFIG_KEYS } = require('./config.service');
const { Msg91Provider } = require('./providers/msg91.provider');
const { GenericProvider } = require('./providers/generic.provider');

const log = logger.childFor('sms-service');

/**
 * Thin facade over the SMS gateway providers. Every call resolves the
 * tenant-scoped gateway config (per-tenant Setting over env defaults) and
 * delegates to the matching provider implementation. Returns normalized
 * { providerMessageId, raw } so callers never deal with provider-specific
 * shapes.
 */
class SmsService {
  constructor({ configService = new SmsConfigService() } = {}) {
    this.configService = configService;
  }

  _provider(name) {
    return name === 'msg91' ? new Msg91Provider() : new GenericProvider();
  }

  async _resolve(tenantId) {
    const config = await this.configService.get(tenantId);
    return { config, provider: this._provider(this.configService.providerName(config)) };
  }

  async sendText(tenantId, { to, body }) {
    const { config, provider } = await this._resolve(tenantId);
    if (!this.configService.isConfigured(config)) {
      throw new AppError('SMS gateway is not configured for this tenant', 503, null, 'SMS_NOT_CONFIGURED');
    }
    const result = await provider.sendText({
      to,
      body,
      apiKey: config[SMS_CONFIG_KEYS.API_KEY],
      senderId: config[SMS_CONFIG_KEYS.SENDER_ID],
      route: config[SMS_CONFIG_KEYS.ROUTE],
      templateId: config[SMS_CONFIG_KEYS.TEMPLATE_ID],
      baseUrl: config[SMS_CONFIG_KEYS.API_URL] || undefined,
    });
    log.info('sms sent', { tenantId, provider: this.configService.providerName(config), hasId: Boolean(result.providerMessageId) });
    return { providerMessageId: result.providerMessageId || null, raw: result.raw };
  }

  async testConnection(tenantId) {
    const { config, provider } = await this._resolve(tenantId);
    if (!this.configService.isConfigured(config)) {
      return { ok: false, error: 'SMS gateway is not configured' };
    }
    try {
      return await provider.testConnection({
        apiKey: config[SMS_CONFIG_KEYS.API_KEY],
        senderId: config[SMS_CONFIG_KEYS.SENDER_ID],
        route: config[SMS_CONFIG_KEYS.ROUTE],
        templateId: config[SMS_CONFIG_KEYS.TEMPLATE_ID],
        baseUrl: config[SMS_CONFIG_KEYS.API_URL] || undefined,
      });
    } catch (err) {
      log.warn('sms connection test failed', { tenantId, error: err.message });
      return { ok: false, error: err.message };
    }
  }

  /** Sends a real test SMS (used by the dashboard "send test" action). */
  async sendTestMessage(tenantId, { to, body = 'Test message from the WhatsApp + Bitrix24 integration dashboard.' }) {
    return this.sendText(tenantId, { to, body });
  }
}

module.exports = { SmsService };
