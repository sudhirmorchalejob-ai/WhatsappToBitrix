const logger = require('../../utils/logger');
const { sendSuccess, sendError } = require('../../utils/ApiResponse');
const { WEBHOOK_LOG_STATUS } = require('../../constants');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');
const { normalizeWebhook } = require('./normalizers');
const { WebhookDispatcher } = require('../whatsbox/dispatcher');

const log = logger.childFor('meta-webhook-controller');

const webhookLogRepository = new WebhookLogRepository();

// The canonical event model is provider-agnostic, so the Meta endpoint
// reuses the same dispatcher + domain handlers as WhatsBox.
const dispatcher = new WebhookDispatcher({
  messageHandler: require('../whatsbox/handlers/incomingMessage.handler').defaultHandler,
  statusHandler: require('../whatsbox/handlers/messageStatus.handler').defaultHandler,
});

async function handle(req, res) {
  const signature = req.get('x-hub-signature-256') || null;

  // req.body is the RAW buffer (express.raw mounted on this route)
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    try {
      await webhookLogRepository.create({
        source: 'META',
        eventType: 'parse_error',
        payload: null,
        status: WEBHOOK_LOG_STATUS.FAILED,
        ip: req.ip,
        signature,
      });
    } catch (e) {
      log.error('failed to persist webhook log', { error: e.message });
    }
    return sendError(res, 'Invalid JSON body', 400);
  }

  const { events, error } = normalizeWebhook(payload);
  if (error) log.warn('webhook partially normalized', { error });

  const processed = [];

  for (const { kind, canonical } of events) {
    let webhookLog;
    try {
      webhookLog = await webhookLogRepository.create({
        source: 'META',
        eventType: `${kind}_${canonical.type || canonical.status || 'unknown'}`,
        payload: canonical.raw,
        status: WEBHOOK_LOG_STATUS.RECEIVED,
        ip: req.ip,
        signature,
      });
    } catch (e) {
      log.error('failed to persist webhook log', { error: e.message, messageId: canonical.messageId });
      continue;
    }

    try {
      const result = await dispatcher.dispatch(canonical);
      await webhookLogRepository.markProcessed(webhookLog.id, {
        status: WEBHOOK_LOG_STATUS.PROCESSED,
        processedAt: new Date(),
      });
      processed.push({ kind, id: canonical.messageId, ok: true, result });
    } catch (e) {
      log.error('webhook processing failed', { kind, messageId: canonical.messageId, error: e.message });
      try {
        await webhookLogRepository.markProcessed(webhookLog.id, {
          status: WEBHOOK_LOG_STATUS.FAILED,
          errorMessage: e.message,
          processedAt: new Date(),
        });
      } catch (logErr) {
        log.error('failed to update webhook log', { error: logErr.message });
      }
      processed.push({ kind, id: canonical.messageId, ok: false, error: e.message });
    }
  }

  return sendSuccess(res, { received: events.length, processed });
}

module.exports = { handle };
