const { z } = require('zod');
const { env } = require('../../config');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { normalizePhone } = require('../../helpers/phone');
const { WhatsBoxClient } = require('./client');

const log = logger.childFor('whatsbox-service');

const MEDIUM = 'WHATSAPP_B24_INTEGRATION';
const WHATSBOX_MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

// ------------------------------------------------------------------
// Zod schemas
// ------------------------------------------------------------------

const baseSendSchema = z.object({
  to: z
    .string()
    .min(3, 'Recipient phone must contain at least 3 digits')
    .transform(normalizePhone),
  channelId: z.string().min(1).optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  name: z.string().max(255).optional(),
});

const sendTextSchema = baseSendSchema.extend({
  body: z.string().min(1).max(4096),
  previewUrl: z.boolean().optional(),
});

const sendMediaSchema = baseSendSchema.extend({
  type: z.enum(WHATSBOX_MEDIA_TYPES),
  link: z.string().url('Media link must be a valid public URL'),
  caption: z.string().max(1000).optional(),
  filename: z.string().max(255).optional(),
});

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

class WhatsBoxService {
  constructor(options = {}) {
    this.options = typeof options === 'string' ? { baseURL: options } : (options || {});
    this.client = null;
  }

  _ensureConfigured(customUrl = null) {
    const baseURL =
      customUrl ||
      this.options.baseURL ||
      this.options.apiUrl ||
      env.WHATSBOX_API_URL ||
      env.WHATSAPP_WEBHOOK_URL;
    const apiKey =
      this.options.apiKey !== undefined ? this.options.apiKey : env.WHATSBOX_API_KEY;

    if (!baseURL) {
      throw new AppError(
        'WhatsApp Gateway URL is not configured',
        503,
        null,
        'WHATSBOX_NOT_CONFIGURED'
      );
    }
    if (!this.client || customUrl || this.options.baseURL) {
      this.client = new WhatsBoxClient({
        baseURL,
        apiKey: apiKey || undefined,
      });
    }
    return this.client;
  }

  _sendPath(kind) {
    if (!env.WHATSBOX_API_KEY) return '';
    return kind === 'text' ? 'messages/text' : 'messages/media';
  }

  _defaultChannelId() {
    return env.WHATSBOX_CHANNEL_ID || undefined;
  }

  // ---------------- Send ----------------

  async sendText(input) {
    const { to, body, previewUrl, channelId, userId, name } = sendTextSchema.parse(input);

    // The automation behind the gateway webhook may read the recipient
    // under different keys and with or without a leading "+". Carry common
    // aliases so the payload works regardless of its exact schema.
    const recipient = String(to || '').replace(/^\+/, '');
    const phoneWithPlus = recipient ? `+${recipient}` : recipient;

    const payload = {
      medium: MEDIUM,
      channel_id: channelId || this._defaultChannelId(),
      to: phoneWithPlus,
      phone: phoneWithPlus,
      number: phoneWithPlus,
      recipient: phoneWithPlus,
      name,
      user_id: userId,
      body,
      message: body,
      text: body,
      preview_url: previewUrl,
    };

    const data = await this._ensureConfigured().post(this._sendPath('text'), payload);
    return this._extractResult(data);
  }

  async sendImage(input) {
    return this.sendMedia({ ...input, type: 'image' });
  }

  async sendVideo(input) {
    return this.sendMedia({ ...input, type: 'video' });
  }

  async sendAudio(input) {
    return this.sendMedia({ ...input, type: 'audio' });
  }

  async sendDocument(input) {
    return this.sendMedia({ ...input, type: 'document' });
  }

  /** PDFs are sent as WhatsApp `document` media with a filename. */
  async sendPdf(input) {
    return this.sendMedia({ ...input, type: 'document' });
  }

  async sendMedia(input) {
    const { type, to, link, caption, filename, channelId, userId, name } =
      sendMediaSchema.parse(input);

    const payload = {
      medium: MEDIUM,
      channel_id: channelId || this._defaultChannelId(),
      to,
      name,
      user_id: userId,
      type,
      link,
      caption,
      filename,
    };

    const data = await this._ensureConfigured().post(this._sendPath('media'), payload);
    return this._extractResult(data);
  }

  async sendTemplate(input) {
    const { to, template, channelId, userId, name } = input;

    if (!template || !template.name) {
      throw new AppError('Template name is required', 400, null, 'TEMPLATE_NAME_REQUIRED');
    }

    const payload = {
      medium: MEDIUM,
      channel_id: channelId || this._defaultChannelId(),
      to,
      name,
      user_id: userId,
      template,
    };

    const data = await this._ensureConfigured().post('messages/template', payload);
    return this._extractResult(data);
  }

  async downloadMedia(url, options) {
    return this._ensureConfigured().download(url, options);
  }

  /**
   * Reachability probe. Directly checks gateway connectivity without URL mangling.
   */
  async testConnection(customUrl = null) {
    const baseURL =
      customUrl ||
      this.options.baseURL ||
      this.options.apiUrl ||
      env.WHATSBOX_API_URL ||
      env.WHATSAPP_WEBHOOK_URL;

    if (!baseURL) {
      return {
        ok: false,
        configured: false,
        error: 'WhatsApp Gateway URL is not configured',
      };
    }

    const axios = require('axios');
    try {
      const res = await axios.get(baseURL, {
        timeout: 10000,
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 500) {
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            configured: true,
            status: res.status,
            error: 'Authentication failed (401/403 Unauthorized)',
          };
        }
        return {
          ok: true,
          configured: true,
          status: res.status,
          message: 'Connected and reachable',
        };
      }

      return {
        ok: false,
        configured: true,
        status: res.status,
        error: `Server responded with status HTTP ${res.status}`,
      };
    } catch (err) {
      try {
        const postRes = await axios.post(
          baseURL,
          { probe: true, timestamp: Date.now() },
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );
        if (postRes.status >= 200 && postRes.status < 500) {
          return {
            ok: true,
            configured: true,
            status: postRes.status,
            message: 'Connected and reachable',
          };
        }
      } catch {
        // Fallback error ignored
      }

      log.warn('WhatsApp gateway test probe failed', { url: baseURL, error: err.message });
      return {
        ok: false,
        configured: true,
        error: err.code === 'ECONNREFUSED' ? 'Connection refused by gateway' : err.message,
      };
    }
  }

  // ---------------- Result mapping ----------------

  /**
   * Normalizes unknown WhatsBox success shapes into { whatsboxMessageId, raw }.
   */
  _extractResult(data) {
    if (!data || typeof data !== 'object') {
      return { whatsboxMessageId: null, raw: data };
    }

    const candidates = [
      data.id,
      data.data && data.data.id,
      data.data && Array.isArray(data.data) && data.data[0] && data.data[0].id,
      data.result && data.result.id,
      data.result && Array.isArray(data.result) && data.result[0] && data.result[0].id,
    ];

    const id = candidates.find((c) => typeof c === 'string' || typeof c === 'number');
    return { whatsboxMessageId: id != null ? String(id) : null, raw: data };
  }
}

module.exports = { WhatsBoxService, WHATSBOX_MEDIA_TYPES, MEDIUM };
