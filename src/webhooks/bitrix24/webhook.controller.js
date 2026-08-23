const axios = require('axios');
const logger = require('../../utils/logger');
const { env } = require('../../config');
const { WEBHOOK_SOURCE, WEBHOOK_LOG_STATUS } = require('../../constants');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');
const { TenantRepository } = require('../../repositories/tenant.repository');
const { normalizeBitrix24Webhook } = require('./normalizers');
const { LeadAddedHandler } = require('./handlers/lead.handler');
const { OperatorMessageHandler } = require('./handlers/operatorMessage.handler');
const { OutgoingMessageService } = require('../../services/outgoingMessage.service');
const { WhatsBoxService } = require('../../services/whatsbox');

const log = logger.childFor('bitrix24-webhook-controller');

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function createWebhookController({
  webhookLogRepository = new WebhookLogRepository(),
  tenantRepository = new TenantRepository(),
  leadHandler = new LeadAddedHandler(),
  operatorHandler = new OperatorMessageHandler(),
} = {}) {
  return {
    async handle(req, res) {
      // 1. Immediately acknowledge Bitrix24 to prevent timeouts
      res.status(200).json({ status: 'success' });

      try {
        const body = req.body || {};
        log.info('incoming Bitrix24 webhook received', {
          event: body.event,
          hasData: Boolean(body.data),
          hasAuth: Boolean(body.auth),
        });

        // ------------------------------------------------------------------
        // Case 1: Direct Outbound CRM Automation / Robot Webhook (message_to / message_body)
        // ------------------------------------------------------------------
        const props = body.properties || {};
        const phone = firstDefined(
          body.message_to,
          props.phone_number,
          body.phone_number,
          body.phone,
          body.mobile,
          body.number,
          body.to,
          body.recipient
        );
        const message = firstDefined(
          body.message_body,
          props.message_text,
          body.message_text,
          body.message,
          body.body,
          body.text,
          body.content
        );

        if (phone && message) {
          log.info('processing direct Bitrix24 automation message', { phone });

          // Resolve tenant
          let tenant = null;
          if (req.tenantId) {
            tenant = await tenantRepository.findById(req.tenantId);
          }
          if (!tenant) {
            tenant = await tenantRepository.findFirstActive();
          }

          const tenantId = tenant ? tenant.id : null;
          const channelId = (tenant && tenant.whatsboxChannelId) || env.WHATSBOX_CHANNEL_ID || undefined;
          const gatewayUrl = (tenant && tenant.whatsappWebhookUrl) || env.WHATSBOX_API_URL || env.WHATSAPP_WEBHOOK_URL;

          const whatsbox = new WhatsBoxService({ baseURL: gatewayUrl });
          const outService = new OutgoingMessageService({ whatsbox });

          try {
            await outService.sendText({
              to: phone,
              body: message,
              channelId,
              tenantId,
            });
            log.info('direct Bitrix24 automation message sent successfully', { phone });
          } catch (sendErr) {
            log.error('direct Bitrix24 automation message send failed', { phone, error: sendErr.message });
          }
          return;
        }

        // ------------------------------------------------------------------
        // Case 2: Bitrix24 Event Webhooks (ONCRMLEADADD, ONIMCONNECTORMESSAGEADD, etc.)
        // ------------------------------------------------------------------
        const auth = body.auth || (req.b24Auth && req.b24Auth.auth) || {};
        const install = req.b24Auth && req.b24Auth.install ? req.b24Auth.install : null;
        const tenantId = (install && install.tenantId) || req.tenantId || null;

        const { events, error } = normalizeBitrix24Webhook(body);
        if (error) log.warn('bitrix24 webhook normalization issue', { error });

        for (const { kind, eventName, canonical } of events) {
          let webhookLog = null;
          try {
            webhookLog = await webhookLogRepository.create({
              tenantId,
              source: WEBHOOK_SOURCE.BITRIX24,
              eventType: `${eventName}:${kind}`,
              payload: canonical.raw || body,
              status: WEBHOOK_LOG_STATUS.RECEIVED,
              ip: req.ip,
              signature: null,
            });
          } catch (e) {
            log.error('failed to persist webhook log', { error: e.message });
          }

          try {
            let result;
            if (kind === 'leadAdded') {
              result = await leadHandler.handle(canonical, { install, auth });
            } else if (kind === 'operatorMessage' || kind === 'operatorMessageUpdate') {
              result = await operatorHandler.handle(canonical, { install, auth });
            } else {
              log.info('unhandled Bitrix24 event skipped', { eventName, kind });
            }

            if (webhookLog) {
              await webhookLogRepository.markProcessed(webhookLog.id, {
                status: WEBHOOK_LOG_STATUS.PROCESSED,
                processedAt: new Date(),
              });
            }
          } catch (handlerErr) {
            log.error('bitrix24 event handler error', { kind, eventName, error: handlerErr.message });
            if (webhookLog) {
              await webhookLogRepository.markProcessed(webhookLog.id, {
                status: WEBHOOK_LOG_STATUS.FAILED,
                errorMessage: handlerErr.message,
                processedAt: new Date(),
              });
            }
          }
        }
      } catch (err) {
        log.error('unexpected error in bitrix24 webhook handler', { error: err.message });
      }
    },
  };
}

const defaultController = createWebhookController();

module.exports = { createWebhookController, handle: defaultController.handle };

