const { sendSuccess } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { SmsConfigService, SMS_CONFIG_KEYS } = require('../services/sms/config.service');
const { SmsService } = require('../services/sms/sms.service');

/**
 * Dashboard endpoints for the SMS gateway config (/api/sms/*).
 * Tenant-scoped via req.tenantId (authenticated routes).
 */
class SmsController {
  constructor({ configService = new SmsConfigService(), smsService = new SmsService() } = {}) {
    this.configService = configService;
    this.smsService = smsService;
  }

  async getConfig(req, res) {
    const tenantId = req.tenantId;
    const { config } = await this.configService.getPublic(tenantId);
    return sendSuccess(res, {
      config,
      configured: this.configService.isConfigured(await this.configService.get(tenantId)),
    });
  }

  async saveConfig(req, res) {
    const tenantId = req.tenantId;
    const input = req.body || {};
    if (!Object.keys(input).some((k) => Object.values(SMS_CONFIG_KEYS).includes(k))) {
      throw new AppError('No valid SMS config keys provided', 400, null, 'SMS_CONFIG_INVALID');
    }
    await this.configService.save(tenantId, input);
    const { config } = await this.configService.getPublic(tenantId);
    return sendSuccess(res, {
      config,
      configured: this.configService.isConfigured(await this.configService.get(tenantId)),
    });
  }

  async test(req, res) {
    const tenantId = req.tenantId;
    const { action, to } = req.body || {};

    if (action === 'send') {
      if (!to) throw new AppError('Recipient phone is required for a test send', 400, null, 'SMS_TEST_TO_REQUIRED');
      const result = await this.smsService.sendTestMessage(tenantId, { to });
      return sendSuccess(res, { ok: true, action, ...result });
    }

    const result = await this.smsService.testConnection(tenantId);
    return sendSuccess(res, { ok: result.ok, action, ...result });
  }
}

module.exports = { SmsController, defaultController: new SmsController() };
