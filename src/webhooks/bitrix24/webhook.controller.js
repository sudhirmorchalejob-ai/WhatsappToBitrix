const logger = require('../../utils/logger');
const { sendSuccess } = require('../../utils/ApiResponse');
const { WEBHOOK_SOURCE, WEBHOOK_LOG_STATUS } = require('../../constants');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');
const { normalizeBitrix24Webhook } = require('./normalizers');
const { OperatorMessageHandler } = require('./handlers/operatorMessage.handler');

const log = logger.childFor('bitrix24-webhook-controller');

function createWebhookController({
  webhookLogRepository = new WebhookLogRepository(),
  handler = new OperatorMessageHandler(),
} = {}) {
  return {
    async handle(req, res) {
      // req.b24Auth is populated by the verifyBitrix24Webhook middleware.
      const { payload, auth, install } = req.b24Auth;

      const { events, error } = normalizeBitrix24Webhook(payload);
      if (error) log.warn('bitrix24 webhook partially normalized', { error });

      const processed = [];

      for (const { kind, eventName, canonical } of events) {
        let webhookLog;
        try {
          webhookLog = await webhookLogRepository.create({
            tenantId: install && install.tenantId ? install.tenantId : null,
            source: WEBHOOK_SOURCE.BITRIX24,
            eventType: `${eventName}:${kind}`,
            payload: canonical.raw,
            status: WEBHOOK_LOG_STATUS.RECEIVED,
            ip: req.ip,
            signature: null,
          });
        } catch (e) {
          log.error('failed to persist webhook log', { error: e.message });
          continue;
        }

        try {
          const result = await handler.handle(canonical, { install, auth });
          await webhookLogRepository.markProcessed(webhookLog.id, {
            status: WEBHOOK_LOG_STATUS.PROCESSED,
            processedAt: new Date(),
          });
          processed.push({ kind, id: canonical.b24MessageId, ok: result.handled, skipped: Boolean(result.skipped), result });
        } catch (e) {
          log.error('bitrix24 webhook processing failed', { kind, b24MessageId: canonical.b24MessageId, error: e.message });
          try {
            await webhookLogRepository.markProcessed(webhookLog.id, {
              status: WEBHOOK_LOG_STATUS.FAILED,
              errorMessage: e.message,
              processedAt: new Date(),
            });
          } catch (logErr) {
            log.error('failed to update webhook log', { error: logErr.message });
          }
          processed.push({ kind, id: canonical.b24MessageId, ok: false, error: e.message });
        }
      }

      return sendSuccess(res, { received: events.length, processed });
    },
  };
}

const defaultController = createWebhookController();

module.exports = { createWebhookController, handle: defaultController.handle };
