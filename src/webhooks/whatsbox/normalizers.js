const { MESSAGE_TYPE, MESSAGE_STATUS } = require('../../constants');
const { normalizePhone } = require('../../helpers/phone');

/**
 * Normalizers: convert provider webhook payloads (WhatsBox / Meta Cloud API)
 * into a single canonical event model that the rest of the app consumes.
 *
 * Supported envelopes:
 *   A) Meta Cloud API: { entry: [{ changes: [{ value: { metadata, contacts,
 *        messages[] | statuses[] } }] }] }
 *   B) Flat envelope:  { event, channel_id, message | status }
 */

const TYPE_MAP = {
  text: MESSAGE_TYPE.TEXT,
  image: MESSAGE_TYPE.IMAGE,
  video: MESSAGE_TYPE.VIDEO,
  audio: MESSAGE_TYPE.AUDIO,
  voice: MESSAGE_TYPE.VOICE,
  document: MESSAGE_TYPE.DOCUMENT,
  sticker: MESSAGE_TYPE.STICKER,
  location: MESSAGE_TYPE.LOCATION,
  contact: MESSAGE_TYPE.CONTACT,
  contacts: MESSAGE_TYPE.CONTACT,
};

const STATUS_MAP = {
  sent: MESSAGE_STATUS.SENT,
  accepted: MESSAGE_STATUS.SENT,
  delivered: MESSAGE_STATUS.DELIVERED,
  read: MESSAGE_STATUS.READ,
  failed: MESSAGE_STATUS.FAILED,
  pending: MESSAGE_STATUS.PENDING,
  queued: MESSAGE_STATUS.PENDING,
};

// ---------------------------------------------------------------- helpers

function toDate(value) {
  if (!value) return new Date();
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function mapType(type, media) {
  const lower = String(type || '').toLowerCase();
  const mime = media && media.mediaMimeType ? String(media.mediaMimeType).toLowerCase() : '';

  if (lower === 'document' && mime === 'application/pdf') {
    return MESSAGE_TYPE.PDF;
  }
  if (lower === 'audio' && /audio\/ogg/.test(mime)) {
    return MESSAGE_TYPE.VOICE;
  }
  return TYPE_MAP[lower] || MESSAGE_TYPE.UNKNOWN;
}

const MEDIA_KEYS = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];

function extractMedia(message) {
  for (const key of MEDIA_KEYS) {
    const m = message[key];
    if (m && typeof m === 'object') {
      return {
        mediaUrl: m.link || m.url || m.id || null,
        mediaMimeType: m.mime_type || m.mimeType || m.mime || null,
        mediaName: m.file_name || m.filename || m.fileName || null,
        mediaSize: m.file_size || m.fileSize || null,
        caption: m.caption || null,
      };
    }
  }
  return { mediaUrl: null, mediaMimeType: null, mediaName: null, mediaSize: null, caption: null };
}

function extractText(message, type) {
  if (message.text && typeof message.text.body === 'string' && message.text.body) return message.text.body;
  if (type === MESSAGE_TYPE.TEXT && typeof message.body === 'string') return message.body;
  if (typeof message.body === 'string' && message.body) return message.body;
  return null;
}

function extractLocation(message) {
  const l = message.location;
  if (!l) return null;
  return {
    lat: l.latitude ?? l.lat ?? null,
    lng: l.longitude ?? l.lng ?? l.lon ?? null,
    name: l.name || null,
    address: l.address || null,
  };
}

function extractContactCard(message) {
  const contacts = Array.isArray(message.contacts) && message.contacts.length
    ? message.contacts
    : message.contact
      ? [message.contact]
      : null;

  if (!contacts) return null;

  const first = contacts[0];
  if (!first) return null;

  const rawName = first.name;
  const name =
    (rawName && (rawName.formatted_name || rawName.first_name || rawName.last_name)) ||
    (typeof rawName === 'string' ? rawName : null) ||
    null;

  const phones = (first.phones || [])
    .map((p) => p.phone || p.value || p.number)
    .filter(Boolean)
    .map(normalizePhone);

  const email = (first.emails || []).map((e) => e.email).filter(Boolean)[0] || null;

  return { name, phones, email };
}

// ---------------------------------------------------------------- builders

function normalizeMessage(message, { channelId = null, fromName = null, phoneNumberId = null } = {}) {
  const media = extractMedia(message);
  const type = mapType(message.type, media);
  const body = extractText(message, type);

  return {
    event: 'message',
    provider: 'WHATSBOX',
    channelId: channelId || message.to || null,
    phoneNumberId: phoneNumberId || null,
    messageId: message.id || message.messageId || null,
    from: normalizePhone(message.from),
    fromName: fromName || message.from_name || null,
    timestamp: toDate(message.timestamp),
    type,
    body: body || media.caption || null,
    caption: media.caption || null,
    mediaUrl: media.mediaUrl,
    mediaMimeType: media.mediaMimeType,
    mediaName: media.mediaName,
    mediaSize: media.mediaSize,
    locationData: type === MESSAGE_TYPE.LOCATION ? extractLocation(message) : null,
    contactCard: type === MESSAGE_TYPE.CONTACT ? extractContactCard(message) : null,
    raw: message,
  };
}

function normalizeStatus(status, { channelId = null, phoneNumberId = null } = {}) {
  const errors = status.errors && status.errors[0];
  const failedReason =
    (errors && (errors.message || errors.title || errors.code)) ||
    status.error ||
    null;

  return {
    event: 'status',
    provider: 'WHATSBOX',
    channelId: channelId || status.channel_id || null,
    phoneNumberId: phoneNumberId || null,
    messageId: status.message_id || status.messageId || status.id || null,
    status: STATUS_MAP[String(status.status || '').toLowerCase()] || null,
    failedReason,
    timestamp: toDate(status.timestamp),
    channelId: channelId || status.channel_id || null,
    raw: status,
  };
}

function normalizeMetaValue(value) {
  const events = [];
  const metadata = value.metadata || {};
  const displayPhone = metadata.display_phone_number || metadata.phone_number_id || null;
  const phoneNumberId = metadata.phone_number_id || null;

  const namesByWaId = {};
  for (const c of value.contacts || []) {
    if (c.profile && c.profile.name && c.wa_id) namesByWaId[c.wa_id] = c.profile.name;
  }

  for (const m of value.messages || []) {
    events.push({ kind: 'message', canonical: normalizeMessage(m, { channelId: displayPhone, phoneNumberId, fromName: namesByWaId[m.from] }) });
  }
  for (const s of value.statuses || []) {
    events.push({ kind: 'status', canonical: normalizeStatus(s, { channelId: displayPhone, phoneNumberId }) });
  }
  return events;
}

// ---------------------------------------------------------------- entry point

/**
 * Accepts either the Meta Cloud API envelope or a flat envelope.
 * Returns { events: [{ kind: 'message'|'status', canonical }], error? }
 */
function normalizeWebhook(payload) {
  if (!payload || typeof payload !== 'object') {
    return { events: [], error: 'Payload is not an object' };
  }

  const events = [];
  let error = null;

  if (Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;
        try {
          events.push(...normalizeMetaValue(value));
        } catch (e) {
          error = e.message;
        }
      }
    }
    return { events, error };
  }

  const eventName = String(payload.event || payload.event_type || '').toLowerCase();
  const looksLikeStatus = eventName.includes('status') || !!payload.status || Array.isArray(payload.statuses);
  const message = payload.message || (Array.isArray(payload.messages) && payload.messages[0]) || (payload.data && payload.data.message);
  const channelId = payload.channel_id || payload.channelId || null;

  try {
    if (message && !looksLikeStatus) {
      events.push({ kind: 'message', canonical: normalizeMessage(message, { channelId }) });
    } else {
      const status = payload.status || (Array.isArray(payload.statuses) && payload.statuses[0]) || (payload.data && payload.data.status);
      if (status) {
        events.push({ kind: 'status', canonical: normalizeStatus(status, { channelId }) });
      }
    }
  } catch (e) {
    error = e.message;
  }

  return { events, error };
}

module.exports = { normalizeWebhook, normalizeMessage, normalizeStatus };
