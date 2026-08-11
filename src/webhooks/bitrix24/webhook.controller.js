const axios = require('axios');
const logger = require('../../utils/logger');
const { env } = require('../../config');
const { sendSuccess } = require('../../utils/ApiResponse');
const { WEBHOOK_SOURCE, WEBHOOK_LOG_STATUS } = require('../../constants');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');
const { normalizeBitrix24Webhook } = require('./normalizers');
const { OperatorMessageHandler } = require('./handlers/operatorMessage.handler');
const { LeadAddedHandler } = require('./handlers/lead.handler');

const log = logger.childFor('bitrix24-webhook-controller');

function createWebhookController({
  webhookLogRepository = new WebhookLogRepository(),
  handler = new OperatorMessageHandler(),
  leadHandler = new LeadAddedHandler(),
} = {}) {
  return {
    async handle(req, res) {
      // ================= DEBUG BLOCK (temporary, do not remove) =================
      const safeJson = (data) => {
        try {
          return JSON.stringify(data, null, 2);
        } catch (err) {
          return String(data);
        }
      };
      console.log('\n' + '='.repeat(60));
      console.log('========== OUTBOUND MESSAGE FROM BITRIX24 ==========');
      console.log('='.repeat(60));
      console.log(`HTTP METHOD: ${req.method}`);
      console.log(`FULL URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
      console.log('QUERY PARAMS:');
      console.log(safeJson(req.query));
      console.log('PARSED BODY:');
      console.log(safeJson(req.body));
      console.log('='.repeat(60) + '\n');
      // =========================================================================

      // ------------------------------------------------------------------
      // Outbound SMS from the registered Bitrix24 message provider
      // (CODE averlon_sms -> HANDLER /webhooks/bitrix24). Payload carries
      // message_to / message_body. Forward to the WhatsBox gateway.
      // ------------------------------------------------------------------
      const messageTo = String(req.body?.message_to || req.body?.phone || req.body?.to || '').trim();
      const messageBody = String(req.body?.message_body || req.body?.text || req.body?.message || '').trim();

      if (messageTo && messageBody) {
        // 1automations/WhatsBox reads the recipient + text under several
        // aliases; carry all of them so the workflow never misses a field.
        const recipient = messageTo.replace(/^\+/, '');
        const phoneWithPlus = recipient ? `+${recipient}` : recipient;
        const payload = {
          medium: 'WHATSAPP_B24_INTEGRATION',
          channel_id: env.WHATSBOX_CHANNEL_ID || undefined,
          to: phoneWithPlus,
          phone: phoneWithPlus,
          number: phoneWithPlus,
          recipient: phoneWithPlus,
          body: messageBody,
          message: messageBody,
          text: messageBody,
        };

        console.log('\n========== DISPATCHING TO WHATSBOX ==========');
        console.log('WhatsBox URL:', env.WHATSBOX_API_URL);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        console.log('==============================================\n');

        // Fire-and-forget: acknowledge Bitrix24 right away; do not wait
        // for the external API so Bitrix24 never times out.
        if (env.WHATSBOX_API_URL) {
          axios
            .post(env.WHATSBOX_API_URL, payload, { timeout: 30000 })
            .then((response) => {
              console.log('\n========== WHATSBOX SEND SUCCESS ==========');
              console.log('HTTP Status:', response.status);
              console.log('Response:', JSON.stringify(response.data, null, 2));
              console.log('===========================================\n');
            })
            .catch((err) => {
              const detail = err.response ? JSON.stringify(err.response.data) : err.message;
              console.log('\n========== WHATSBOX SEND FAILED ==========');
              console.log('Payload:', JSON.stringify(payload, null, 2));
              console.log('Error:', detail);
              console.log('==========================================\n');
            });
        } else {
          console.log('\n========== WHATSBOX SEND SKIPPED ==========');
          console.log('WHATSBOX_API_URL is not configured');
          console.log('===========================================\n');
        }

        return res.status(200).send({ status: 'ok' });
      }

      // ------------------------------------------------------------------
      // Legacy Bitrix24 connector events (operator messages, lead mirror).
      // req.b24Auth is populated by the verifyBitrix24Webhook middleware —
      // which is currently bypassed on the route, so guard for its absence.
      // ------------------------------------------------------------------
      const { payload, auth, install } = req.b24Auth || {};
      if (!payload) {
        return res.status(200).json({ status: 'ignored' });
      }

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
          const result =
            kind === 'leadAdded'
              ? await leadHandler.handle(canonical, { install, auth })
              : await handler.handle(canonical, { install, auth });
          await webhookLogRepository.markProcessed(webhookLog.id, {
            status: WEBHOOK_LOG_STATUS.PROCESSED,
            processedAt: new Date(),
          });
          processed.push({ kind, id: canonical.b24MessageId || canonical.leadId || null, ok: result.handled, skipped: Boolean(result.skipped), result });
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
