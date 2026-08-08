const { BITRIX24_EVENTS } = require('../../constants');

/**
 * Bitrix24 webhook normalizers.
 *
 * Unlike the WhatsApp providers there is no shared canonical model yet:
 * Bitrix24 events carry CRM/open-line semantics, so the normalizer only
 * extracts the fields the Open Channels handlers need and leaves the
 * domain decisions to the handler.
 *
 * Supported envelopes:
 *   ONIMCONNECTORMESSAGEADD    - operator reply sent through the custom
 *                                connector. data: { CONNECTOR, LINE,
 *                                MESSAGES: [{ im, message, chat }] }.
 *   ONIMCONNECTORMESSAGEUPDATE - operator edit (handled in Phase 9).
 *   crm.lead.onAdd             - a lead was created in the portal. When
 *                                its title carries the campaign marker the
 *                                handler mirrors it into a local campaign.
 *   everything else            - passed through as an unhandled event so
 *                                the controller can still audit it.
 */

function toDate(value) {
  if (value === undefined || value === null || value === '') return new Date();
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

function pick(value, keys, fallback = null) {
  if (value === null || value === undefined) return fallback;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') return value[key];
  }
  return fallback;
}

/**
 * Extracts attachments from a Bitrix24 connector message. Each file entry
 * carries { name, path, link, type (mime), size }; only entries with a
 * downloadable link or server path survive. The first file is surfaced
 * as `file` (WhatsApp sends one attachment per message).
 */
function normalizeFiles(files) {
  if (!Array.isArray(files)) return null;
  const normalized = files
    .filter((f) => f && typeof f === 'object' && (f.link || f.path))
    .map((f) => ({
      name: pick(f, ['name'], null),
      link: pick(f, ['link'], null),
      path: pick(f, ['path'], null),
      mimeType: pick(f, ['type', 'mimeType', 'mime_type'], null),
      size: Number(pick(f, ['size'], null)) || null,
    }));
  return normalized.length ? normalized : null;
}

function normalizeOperatorMessage(message, { connector, line, memberId, ts, eventName }) {
  const im = pick(message, ['im'], {});
  const msg = pick(message, ['message'], {});
  const chat = pick(message, ['chat'], {});
  const files = normalizeFiles(msg.files);

  return {
    event: 'operatorMessage',
    provider: 'BITRIX24',
    eventName,
    memberId,
    connector,
    line,
    b24ChatId: pick(im, ['chat_id', 'chatId']),
    b24MessageId: pick(im, ['message_id', 'messageId']),
    userId: pick(msg, ['user_id', 'userId']),
    text: pick(msg, ['text'], null),
    files,
    file: files && files.length ? files[0] : null,
    externalChatId: pick(chat, ['id'], null),
    timestamp: toDate(ts),
    raw: message,
  };
}

/**
 * Normalizes a Bitrix24 webhook payload into canonical events.
 * Returns { events: [{ kind, eventName, canonical }], error? }.
 */
function normalizeBitrix24Webhook(payload) {
  if (!payload || typeof payload !== 'object') {
    return { events: [], error: 'Payload is not an object' };
  }

  const eventName = String(payload.event || '').toUpperCase();
  const auth = (payload && payload.auth) || {};
  const memberId = auth.member_id || auth.memberId || null;
  const data = (payload && payload.data) || {};
  const events = [];
  let error = null;

  try {
    if (eventName === BITRIX24_EVENTS.CONNECTOR_MESSAGE_ADD) {
      const connector = data.CONNECTOR;
      const line = data.LINE;
      for (const message of data.MESSAGES || []) {
        const canonical = normalizeOperatorMessage(message, { connector, line, memberId, ts: payload.ts, eventName });
        events.push({ kind: canonical.event, eventName, canonical });
      }
    } else if (eventName === BITRIX24_EVENTS.CONNECTOR_MESSAGE_UPDATE) {
      const connector = data.CONNECTOR;
      const line = data.LINE;
      for (const message of data.MESSAGES || []) {
        const canonical = normalizeOperatorMessage(message, { connector, line, memberId, ts: payload.ts, eventName });
        canonical.event = 'operatorMessageUpdate';
        events.push({ kind: canonical.event, eventName, canonical });
      }
    } else if (eventName === BITRIX24_EVENTS.CRM_LEAD_ADD.toUpperCase()) {
      const leadId = pick(data.FIELDS, ['ID']);
      if (leadId !== null) {
        events.push({
          kind: 'leadAdded',
          eventName,
          canonical: {
            event: 'leadAdded',
            provider: 'BITRIX24',
            eventName,
            memberId,
            leadId: Number(leadId),
            raw: payload,
          },
        });
      }
    } else {
      events.push({
        kind: 'other',
        eventName,
        canonical: { event: 'other', provider: 'BITRIX24', eventName, memberId, raw: payload },
      });
    }
  } catch (e) {
    error = e.message;
  }

  return { events, error };
}

module.exports = { normalizeBitrix24Webhook, normalizeOperatorMessage };
