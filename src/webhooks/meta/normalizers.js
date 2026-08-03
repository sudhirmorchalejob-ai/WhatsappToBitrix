const { MESSAGE_TYPE } = require('../../constants');
const {
  normalizeMessage: whatsboxNormalizeMessage,
  normalizeStatus: whatsboxNormalizeStatus,
} = require('../whatsbox/normalizers');

/**
 * Meta Cloud API normalizers. Build on the shared WhatsBox canonical
 * builders (which already handle the Meta media/text/location/contact
 * envelopes) and add:
 *   - `provider: 'META'`
 *   - Meta-only message types: template, interactive (button/list),
 *     button — mapped to TEXT so the body stays useful in the CRM.
 */

const EXTRA_TYPE_MAP = Object.freeze({
  template: MESSAGE_TYPE.TEXT,
  interactive: MESSAGE_TYPE.TEXT,
  button: MESSAGE_TYPE.TEXT,
});

/**
 * Extracts the user's chosen option from interactive messages:
 *   { interactive: { button_reply: { id, title } } }
 *   { interactive: { list_reply:   { id, title } } }
 * Falls back to the free-text body.
 */
function extractInteractiveBody(message) {
  const interactive = message.interactive;
  if (!interactive || typeof interactive !== 'object') return null;

  const reply = interactive.button_reply || interactive.list_reply || interactive.native_flow_response;
  if (reply && (reply.title || reply.id)) return reply.title || String(reply.id);

  if (interactive.body && typeof interactive.body.text === 'string') return interactive.body.text;
  return null;
}

function normalizeMessage(message, options = {}) {
  const canonical = whatsboxNormalizeMessage(message, options);
  canonical.provider = 'META';
  canonical.phoneNumberId = options.phoneNumberId || null;

  const rawType = String((message && message.type) || '').toLowerCase();
  if (canonical.type === MESSAGE_TYPE.UNKNOWN && EXTRA_TYPE_MAP[rawType]) {
    canonical.type = EXTRA_TYPE_MAP[rawType];

    if (rawType === 'interactive') {
      canonical.body = extractInteractiveBody(message) || canonical.body;
    } else if (rawType === 'template') {
      const template = message.template || {};
      canonical.body = canonical.body || (template.name ? `Template: ${template.name}` : null);
    } else if (rawType === 'button') {
      canonical.body = canonical.body || (message.button && message.button.text) || null;
    }
  }

  return canonical;
}

function normalizeStatus(status, options = {}) {
  const canonical = whatsboxNormalizeStatus(status, options);
  canonical.provider = 'META';
  canonical.phoneNumberId = options.phoneNumberId || null;
  return canonical;
}

/**
 * Normalizes the Meta Cloud API envelope:
 *   { entry: [{ changes: [{ value: { metadata, contacts,
 *       messages[] | statuses[] } }] }] }
 * Returns { events: [{ kind: 'message'|'status', canonical }], error? }
 */
function normalizeWebhook(payload) {
  if (!payload || typeof payload !== 'object') {
    return { events: [], error: 'Payload is not an object' };
  }
  if (!Array.isArray(payload.entry)) {
    return { events: [], error: 'Expected Meta Cloud API envelope (entry array)' };
  }

  const events = [];
  let error = null;

  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      try {
        const metadata = value.metadata || {};
        const displayPhone = metadata.display_phone_number || metadata.phone_number_id || null;
        const phoneNumberId = metadata.phone_number_id || null;

        const namesByWaId = {};
        for (const contact of value.contacts || []) {
          if (contact.profile && contact.profile.name && contact.wa_id) {
            namesByWaId[contact.wa_id] = contact.profile.name;
          }
        }

        for (const message of value.messages || []) {
          events.push({
            kind: 'message',
            canonical: normalizeMessage(message, {
              channelId: displayPhone,
              phoneNumberId,
              fromName: namesByWaId[message.from],
            }),
          });
        }

        for (const status of value.statuses || []) {
          events.push({ kind: 'status', canonical: normalizeStatus(status, { channelId: displayPhone, phoneNumberId }) });
        }
      } catch (e) {
        error = e.message;
      }
    }
  }

  return { events, error };
}

module.exports = { normalizeWebhook, normalizeMessage, normalizeStatus };
