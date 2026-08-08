const { z } = require('zod');
const { env } = require('../../config');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { normalizePhone } = require('../../helpers/phone');
const { MetaClient } = require('./client');

const log = logger.childFor('meta-service');

const META_MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

// ------------------------------------------------------------------
// Zod schemas
// ------------------------------------------------------------------

const baseSendSchema = z.object({
  to: z
    .string()
    .min(3, 'Recipient phone must contain at least 3 digits')
    .transform(normalizePhone),
  phoneNumberId: z.string().min(1).optional(),
});

const sendTextSchema = baseSendSchema.extend({
  body: z.string().min(1).max(4096),
  previewUrl: z.boolean().optional(),
});

const sendMediaSchema = baseSendSchema
  .extend({
    type: z.enum(META_MEDIA_TYPES),
    link: z.string().url('Media link must be a valid public URL').optional(),
    mediaId: z.string().min(1).optional(),
    caption: z.string().max(1024).optional(),
    filename: z.string().max(240).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.link && !value.mediaId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Either link or mediaId is required',
        path: ['link'],
      });
    }
  });

const sendTemplateSchema = baseSendSchema.extend({
  name: z.string().min(1).max(512),
  languageCode: z.string().min(2).max(10).default('en'),
  components: z.array(z.unknown()).optional(),
});

const sendLocationSchema = baseSendSchema.extend({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  name: z.string().max(255).optional(),
  address: z.string().max(512).optional(),
});

const sendContactSchema = baseSendSchema.extend({
  contact: z.object({
    name: z.string().min(1),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phones: z.array(z.string().min(3)).optional(),
    emails: z.array(z.string().email()).optional(),
  }),
});

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

class MetaService {
  constructor() {
    this.client = null;
  }

  _ensureConfigured() {
    if (!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID) {
      throw new AppError(
        'META_ACCESS_TOKEN / META_PHONE_NUMBER_ID is not configured',
        503,
        null,
        'META_NOT_CONFIGURED'
      );
    }
    if (!this.client) {
      this.client = new MetaClient({
        baseURL: env.META_API_BASE_URL,
        version: env.META_GRAPH_VERSION,
        accessToken: env.META_ACCESS_TOKEN,
      });
    }
    return this.client;
  }

  _phoneNumberId(override) {
    return override || env.META_PHONE_NUMBER_ID;
  }

  async _send(payload, phoneNumberIdOverride) {
    const phoneNumberId = this._phoneNumberId(phoneNumberIdOverride);
    const data = await this._ensureConfigured().post(`/${phoneNumberId}/messages`, payload);
    return this._extractResult(data);
  }

  // ---------------- Send ----------------

  async sendText(input) {
    const { to, body, previewUrl, phoneNumberId } = sendTextSchema.parse(input);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        body,
        ...(previewUrl !== undefined && { preview_url: previewUrl }),
      },
    };

    return this._send(payload, phoneNumberId);
  }

  async sendMedia(input) {
    const { to, type, link, mediaId, caption, filename, phoneNumberId } = sendMediaSchema.parse(input);

    const media = link ? { link } : { id: mediaId };
    if (caption !== undefined && type !== 'sticker') media.caption = caption;
    if (filename !== undefined && type === 'document') media.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      [type]: media,
    };

    return this._send(payload, phoneNumberId);
  }

  async sendTemplate(input) {
    const { to, name, languageCode, components, phoneNumberId } = sendTemplateSchema.parse(input);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name,
        language: { code: languageCode, policy: 'deterministic' },
        ...(components && components.length ? { components } : {}),
      },
    };

    return this._send(payload, phoneNumberId);
  }

  async sendLocation(input) {
    const { to, longitude, latitude, name, address, phoneNumberId } = sendLocationSchema.parse(input);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location: {
        longitude,
        latitude,
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
      },
    };

    return this._send(payload, phoneNumberId);
  }

  async sendContact(input) {
    const { to, contact, phoneNumberId } = sendContactSchema.parse(input);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'contacts',
      contacts: [this._buildContactCard(contact)],
    };

    return this._send(payload, phoneNumberId);
  }

  _buildContactCard(contact) {
    const card = {
      name: {
        formatted_name: contact.name,
        ...(contact.firstName !== undefined && { first_name: contact.firstName }),
        ...(contact.lastName !== undefined && { last_name: contact.lastName }),
      },
    };

    if (contact.phones && contact.phones.length) {
      card.phones = contact.phones.map((phone, i) => ({
        phone,
        wa_id: normalizePhone(phone),
        type: i === 0 ? 'CELL' : 'OTHER',
      }));
    }
    if (contact.emails && contact.emails.length) {
      card.emails = contact.emails.map((email) => ({ email }));
    }

    return card;
  }

  // ---------------- Read state / media ----------------

  /**
   * Marks an outgoing message as read in the customer's WhatsApp. Takes
   * the wamid returned by the send endpoints.
   */
  async markAsRead(messageId) {
    if (!messageId) {
      throw new AppError('messageId is required to mark a message as read', 400, null, 'MESSAGE_ID_REQUIRED');
    }

    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    await this._ensureConfigured().post(`/${env.META_PHONE_NUMBER_ID}/messages`, payload);
    return { ok: true };
  }

  /**
   * Resolves a media id to bytes: GET /{mediaId} returns a short-lived
   * download URL, then downloads the file behind it.
   */
  async downloadMedia(mediaId, options) {
    const client = this._ensureConfigured();
    const info = await client.get(`/${mediaId}`);

    if (!info || !info.url) {
      throw new AppError('Meta media info did not include a download URL', 502, null, 'META_MEDIA_NO_URL');
    }

    const file = await client.download(info.url, options);
    return {
      ...file,
      mediaId,
      mimeType: file.mimeType || info.mime_type,
      size: file.size || info.file_size,
    };
  }

  // ---------------- Connectivity ----------------

  /**
   * Reachability + auth probe. GET /{phoneNumberId} returns the phone
   * number object on success, which proves the access token is valid and
   * the number id exists.
   */
  async testConnection() {
    const client = this._ensureConfigured();
    const phoneNumberId = env.META_PHONE_NUMBER_ID;

    try {
      const res = await client.get(`/${phoneNumberId}`, { retries: 0 });
      return {
        ok: true,
        reachable: true,
        authVerified: Boolean(res && res.id),
        phoneNumberId,
      };
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status === 401 || status === 403) {
        return { ok: false, reachable: true, httpStatus: status, authVerified: false, error: err.message };
      }
      if (err.code === 'NETWORK_ERROR' || !status) {
        return { ok: false, reachable: false, error: err.message };
      }
      return { ok: false, reachable: true, httpStatus: status, authVerified: false, error: err.message };
    }
  }

  // ---------------- Result mapping ----------------

  /**
   * Normalizes the send response into { wamid, raw }. Meta returns
   * { messaging_product, contacts: [{ wa_id }], messages: [{ id }] } —
   * the messages[0].id is the WhatsApp message id (wamid).
   */
  _extractResult(data) {
    if (!data || typeof data !== 'object') {
      return { wamid: null, raw: data };
    }

    const wamid =
      data.messages && Array.isArray(data.messages) && data.messages[0] && data.messages[0].id;
    return { wamid: typeof wamid === 'string' ? wamid : null, raw: data };
  }
}

module.exports = { MetaService, META_MEDIA_TYPES };
