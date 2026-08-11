const { MESSAGE_STATUS } = require('../../constants');

/**
 * Pure helpers shared by the SMS providers and the delivery webhook:
 * provider delivery states -> local MessageState, and local MessageState
 * -> Bitrix24 messageservice.message.status.update STATUS value.
 *
 * The Bitrix24 STATUS vocabulary is: queued, sent, delivered, undelivered,
 * failed (no "read" for SMS). Local states are PENDING/SENT/DELIVERED/
 * UNDELIVERED/FAILED.
 */

const LOCAL_TO_BITRIX24 = Object.freeze({
  [MESSAGE_STATUS.PENDING]: 'queued',
  [MESSAGE_STATUS.SENT]: 'sent',
  [MESSAGE_STATUS.DELIVERED]: 'delivered',
  [MESSAGE_STATUS.UNDELIVERED]: 'undelivered',
  [MESSAGE_STATUS.FAILED]: 'failed',
  [MESSAGE_STATUS.READ]: 'delivered',
});

const BITRIX24_STATUSES = Object.freeze(['queued', 'sent', 'delivered', 'undelivered', 'failed']);

/** Raw provider delivery states (case-insensitive) grouped by local state. */
const PROVIDER_STATUS_GROUPS = Object.freeze({
  [MESSAGE_STATUS.DELIVERED]: ['delivered', 'delivrd', 'deliverd', 'success', 'ok', 'sent-to-carrier', 'accepted-by-carrier', 'completed'],
  [MESSAGE_STATUS.READ]: ['read', 'seen'],
  [MESSAGE_STATUS.SENT]: ['sent', 'accepted', 'submitted', 'processed', 'enroute', 'en-route', 'waiting'],
  [MESSAGE_STATUS.PENDING]: ['queued', 'pending', 'queued-for-sending', 'scheduled', 'not-sent-yet'],
  [MESSAGE_STATUS.UNDELIVERED]: ['undelivered', 'undeliv', 'undeliverable', 'not-delivered', 'nondeliv', 'expired', 'rejected', 'rejectd', 'blocked', 'not-sent', 'delivery-impossible'],
  [MESSAGE_STATUS.FAILED]: ['failed', 'error', 'errorcode', 'invalid-number', 'invalid number', 'missing-token', 'invalid-template', 'internal-error'],
});

/**
 * Maps an arbitrary provider status string to a local MessageState.
 * Unknown states fall back to FAILED so a message can never silently sit
 * in limbo after a delivery report.
 */
function mapProviderStatusToLocal(status) {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return null;
  for (const [local, tokens] of Object.entries(PROVIDER_STATUS_GROUPS)) {
    if (tokens.includes(key)) return local;
  }
  return MESSAGE_STATUS.FAILED;
}

/** Validates + normalizes a Bitrix24 delivery status value. */
function normalizeBitrix24Status(status) {
  const value = String(status || '').trim().toLowerCase();
  return BITRIX24_STATUSES.includes(value) ? value : null;
}

/** Local MessageState -> Bitrix24 STATUS value. */
function localToBitrix24(status) {
  return LOCAL_TO_BITRIX24[status] || 'failed';
}

/**
 * Extracts a provider message id from an arbitrary delivery-report payload.
 * MSG91 reports it as `msgid`; generic providers commonly use message_id,
 * messageId, request_id, id, or data.id.
 */
function extractProviderMessageId(payload, provider = 'generic') {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.msgid,
    payload.message_id,
    payload.messageId,
    payload.messageid,
    payload.request_id,
    payload.requestId,
    payload.id,
    payload.data && payload.data.id,
    payload.data && payload.data.message_id,
    payload.result && payload.result.id,
  ];

  const found = candidates.find((c) => typeof c === 'string' || typeof c === 'number');
  return found != null ? String(found) : null;
}

module.exports = {
  LOCAL_TO_BITRIX24,
  BITRIX24_STATUSES,
  PROVIDER_STATUS_GROUPS,
  mapProviderStatusToLocal,
  normalizeBitrix24Status,
  localToBitrix24,
  extractProviderMessageId,
};
