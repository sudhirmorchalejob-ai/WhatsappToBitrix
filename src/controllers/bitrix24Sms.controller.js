const { sendSuccess, sendError } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { Bitrix24SmsMessageHandler } = require('../services/sms/bitrix24SmsMessageHandler.service');

/**
 * Public endpoint Bitrix24 calls when a message is sent through the app's
 * SMS provider (HANDLER of messageservice.sender.add). No API key is
 * required — the provider `code` in the payload resolves the portal.
 */
class Bitrix24SmsController {
  constructor({ handler = new Bitrix24SmsMessageHandler() } = {}) {
    this.handler = handler;
  }

  async handle(req, res) {
    try {
      const result = await this.handler.handleIncoming(req.body || {});
      return sendSuccess(res, result, { status: 200 });
    } catch (err) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return sendError(res, err.message, status);
    }
  }
}

module.exports = { Bitrix24SmsController };
