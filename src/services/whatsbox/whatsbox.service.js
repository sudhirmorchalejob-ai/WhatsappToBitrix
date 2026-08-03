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
  constructor() {
    this.client = null;
  }

  _ensureConfigured() {
    if (!env.WHATSBOX_API_URL || !env.WHATSBOX_API_KEY) {
      throw new AppError(
        'WHATSBOX_API_URL / WHATSBOX_API_KEY is not configured',
        503,
        null,
        'WHATSBOX_NOT_CONFIGURED'
      );
    }
    if (!this.client) {
      this.client = new WhatsBoxClient({
        baseURL: env.WHATSBOX_API_URL,
        apiKey: env.WHATSBOX_API_KEY,
      });
    }
    return this.client;
  }

  _defaultChannelId() {
    return env.WHATSBOX_CHANNEL_ID || undefined;
  }

  // ---------------- Send ----------------

  async sendText(input) {
    const { to, body, previewUrl, channelId, userId, name } = sendTextSchema.parse(input);

    const payload = {
      medium: MEDIUM,
      channel_id: channelId || this._defaultChannelId(),
      to,
      name,
      user_id: userId,
      body,
      preview_url: previewUrl,
    };

    const data = await this._ensureConfigured().post('messages/text', payload);
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

    const data = await this._ensureConfigured().post('messages/media', payload);
    return this._extractResult(data);
  }

  async downloadMedia(url, options) {
    return this._ensureConfigured().download(url, options);
  }

  // ---------------- Connectivity ----------------

  /**
   * Reachability probe. The WhatsBox API has no documented auth probe
   * endpoint, so a 2xx/4xx response proves network reachability and the
   * API key is fully validated on the first real send.
   */
  async testConnection() {
    const client = this._ensureConfigured();

    try {
      const res = await client.http.get('/', { timeout: 10000 });
      return {
        ok: true,
        reachable: true,
        httpStatus: res.status,
        authVerified: false,
        note: 'Network OK. API key is validated on the first send.',
      };
    } catch (err) {
      const normalized = err instanceof AppError ? err : err;
      const status = normalized.statusCode || normalized.response?.status;

      if (status === 401 || status === 403) {
        return { ok: false, reachable: true, httpStatus: status, authVerified: false, error: 'Invalid API key' };
      }
      if (normalized.code === 'NETWORK_ERROR' || !status) {
        return { ok: false, reachable: false, error: normalized.message };
      }
      // 404 / 405 etc. still prove the host is reachable.
      return {
        ok: true,
        reachable: true,
        httpStatus: status,
        authVerified: false,
        note: 'Network OK. API key is validated on the first send.',
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
