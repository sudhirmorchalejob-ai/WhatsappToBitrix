const axios = require('axios');
const logger = require('../../utils/logger');
const { WebhookLogRepository } = require('../../repositories/webhookLog.repository');

const log = logger.childFor('bitrix24-webhook-controller');

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

        // 2. Extract variables safely (handling different Bitrix24 payload structures)
        const phone = req.body?.message_to || req.body?.properties?.phone_number || "";
        const message = req.body?.message_body || req.body?.properties?.message_text || "";

        // 3. Construct the exact, flat JSON payload for Averlon
        const payload = {
          phone: phone,
          message: message,
          channel_id: process.env.WHATSBOX_CHANNEL_ID || "15554035922"
        };

        console.log("========== SENDING TO AVERLON ==========");
        console.log(JSON.stringify(payload, null, 2));

        // 4. Dispatch to Averlon with explicit JSON headers
        if (process.env.WHATSBOX_API_URL) {
          const response = await axios.post(process.env.WHATSBOX_API_URL, payload, {
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
