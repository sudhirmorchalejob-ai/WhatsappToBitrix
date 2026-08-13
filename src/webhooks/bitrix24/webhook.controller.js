const axios = require('axios');
const logger = require('../../utils/logger');
const { env } = require('../../config');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');

const log = logger.childFor('bitrix24-webhook-controller');

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function createWebhookController({
  webhookLogRepository = new WebhookLogRepository(),
} = {}) {
  return {
    async handle(req, res) {
      // 1. Immediately acknowledge Bitrix24 to prevent timeouts
      res.status(200).json({ status: 'success' });

      try {
        console.log("========== INCOMING FROM BITRIX24 ==========");
        console.log(JSON.stringify(req.body, null, 2));

        // 2. Extract variables safely (handling different Bitrix24 payload structures).
        // Accepts every common field name so the send never silently drops
        // the recipient or the text.
        const body = req.body || {};
        const props = body.properties || {};
        const phone = firstDefined(
          body.message_to,
          props.phone_number,
          body.phone,
          body.mobile,
          body.number,
          body.to,
          body.recipient
        );
        const message = firstDefined(
          body.message_body,
          props.message_text,
          body.message,
          body.body,
          body.text,
          body.content
        );

        // 3. Construct the exact, flat JSON payload for the WhatsApp gateway.
        // WHATSBOX_CHANNEL_ID comes from config (never a hardcoded fallback).
        const payload = {
          phone,
          message,
          channel_id: env.WHATSBOX_CHANNEL_ID || undefined,
        };

        console.log("========== SENDING TO AVERLON ==========");
        console.log(JSON.stringify(payload, null, 2));

        // 4. Dispatch to the gateway with explicit JSON headers
        if (env.WHATSBOX_API_URL) {
          const response = await axios.post(env.WHATSBOX_API_URL, payload, {
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          console.log("[AVERLON SUCCESS]:", response.data);
        } else {
          console.error("[ERROR]: WHATSBOX_API_URL is not defined in environment variables.");
        }

      } catch (error) {
        console.error("[AVERLON ERROR]:", error.response?.data || error.message);
      }
    },
  };
}

const defaultController = createWebhookController();

module.exports = { createWebhookController, handle: defaultController.handle };
