const { sendSuccess, sendError } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { SmsDeliveryService } = require('../services/sms/smsDelivery.service');

const log = logger.childFor('sms-webhook-controller');

/**
 * Parses the raw webhook body (JSON or form-encoded, per gateway) into an
 * object and runs it through the delivery service.
 */
class SmsWebhookController {
  constructor({ deliveryService = new SmsDeliveryService() } = {}) {
    this.deliveryService = deliveryService;
  }

  _parseBody(rawBody, contentType) {
    if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) return {};
    const type = String(contentType || '').toLowerCase();

    if (type.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody.toString('utf8'));
      return Object.fromEntries(params.entries());
    }
    if (type.includes('application/json') || rawBody.toString('utf8').trim().startsWith('{')) {
      try {
        return JSON.parse(rawBody.toString('utf8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  async handle(req, res) {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
      const body = this._parseBody(rawBody, req.get('content-type'));
      const result = await this.deliveryService.handleDelivery({
        rawBody,
        body,
        query: req.query || {},
        headers: req.headers || {},
      });
      return sendSuccess(res, result, { status: 200 });
    } catch (err) {
      const status = err instanceof AppError ? err.statusCode : 500;
      if (status >= 500) log.error('sms delivery webhook failed', { error: err.message });
      return sendError(res, err.message, status);
    }
  }
}

module.exports = { SmsWebhookController };
