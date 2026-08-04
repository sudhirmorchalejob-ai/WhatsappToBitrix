const logger = require('../../utils/logger');
const { sendSuccess, sendError } = require('../../utils/ApiResponse');
const { WEBHOOK_LOG_STATUS } = require('../../constants');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');
const { normalizeWebhook } = require('./normalizers');
const { WebhookDispatcher } = require('./dispatcher');
const { createTenantChannelResolver } = require('../tenantResolver');

const log = logger.childFor('webhook-controller');

const SIGNATURE_HEADERS = ['x-webhook-signature', 'x-whatsbox-signature', 'x-signature'];

const webhookLogRepository = new WebhookLogRepository();

const dispatcher = new WebhookDispatcher({
  messageHandler: require('./handlers/incomingMessage.handler').defaultHandler,
  statusHandler: require('./handlers/messageStatus.handler').defaultHandler,
});

async function handle(req, res) {
  const signature = SIGNATURE_HEADERS.map((h) => req.get(h)).find(Boolean) || null;
  const resolveTenantId = createTenantChannelResolver();

  // req.body is the RAW buffer (express.raw mounted on this route)
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    try {
      await webhookLogRepository.create({
        source: 'WHATSBOX',
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
    const tenantId = await resolveTenantId(canonical.channelId);
    log.info('whatsbox webhook received', {
      kind,
      event: canonical.event,
      channelId: canonical.channelId,
      from: canonical.from,
      fromName: canonical.fromName || null,
      body: canonical.body ? String(canonical.body).slice(0, 200) : null,
      type: canonical.type || null,
      status: canonical.status || null,
      messageId: canonical.messageId,
      timestamp: canonical.timestamp,
      tenantId,
    });
    let webhookLog;
    try {
      webhookLog = await webhookLogRepository.create({
        tenantId,
        source: 'WHATSBOX',
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
      const result = await dispatcher.dispatch(canonical, { tenantId, ip: req.ip });
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
