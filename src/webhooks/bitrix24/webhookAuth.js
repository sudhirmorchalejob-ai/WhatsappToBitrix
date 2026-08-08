const crypto = require('crypto');
const { sendError } = require('../../utils/ApiResponse');
const { InstallRepository } = require('../../repositories');

/**
 * Constant-time comparison of two strings (sha256 pre-hash so inputs of
 * different lengths never leak through timingSafeEqual).
 */
function safeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Bitrix24 webhook verification.
 *
 * Marketplace-app event handlers receive an `auth` object carrying
 * `member_id` and `application_token`. Bitrix24 signs every event with
 * the application token, so verifying it (constant-time, against the
 * stored install) is the only credential check needed for
 * ONIMCONNECTORMESSAGEADD and friends.
 *
 * Bitrix24 delivers events as application/x-www-form-urlencoded, where
 * the nested `data` / `auth` blocks arrive either in bracket notation
 * (parsed into objects by the urlencoded middleware) or as JSON strings.
 * A parsed object body and a raw JSON Buffer body are both accepted.
 *
 * On success, `req.b24Auth` is populated with { payload, auth,
 * memberId, install } for the controller.
 */
function coerceNestedStrings(payload) {
  for (const key of ['data', 'auth']) {
    const value = payload[key];
    if (typeof value === 'string') {
      try {
        payload[key] = JSON.parse(value);
      } catch {
        // leave the original string untouched
      }
    }
  }
  return payload;
}

function createVerifyBitrix24Webhook({ installRepository = new InstallRepository() } = {}) {
  return async function verifyBitrix24Webhook(req, res, next) {
    let payload = req.body;

    if (Buffer.isBuffer(payload)) {
      try {
        payload = JSON.parse(payload.toString('utf8'));
      } catch {
        return sendError(res, 'Invalid JSON body', 400);
      }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return sendError(res, 'Invalid webhook body', 400);
    }

    coerceNestedStrings(payload);

    const auth = (payload.auth && typeof payload.auth === 'object') ? payload.auth : {};
    const memberId = auth.member_id || auth.memberId;
    const applicationToken = auth.application_token || auth.applicationToken;

    if (!memberId) {
      return sendError(res, 'Webhook event is missing auth.member_id', 403);
    }

    let install;
    try {
      install = await installRepository.findByMemberId(memberId);
    } catch (err) {
      return next(err);
    }

    if (!install) {
      if (process.env.NODE_ENV !== 'production' || !process.env.BITRIX24_CLIENT_ID) {
        req.b24Auth = { payload, auth, memberId: memberId || 'default', install: null };
        return next();
      }
      return sendError(res, 'Unknown Bitrix24 portal', 403);
    }

    if (install.applicationToken && !safeEqualStr(applicationToken, install.applicationToken)) {
      return sendError(res, 'Invalid Bitrix24 webhook application_token', 401);
    }

    req.b24Auth = { payload, auth, memberId, install };
    return next();
  };
}

const verifyBitrix24Webhook = createVerifyBitrix24Webhook();

module.exports = { createVerifyBitrix24Webhook, verifyBitrix24Webhook, safeEqualStr };
