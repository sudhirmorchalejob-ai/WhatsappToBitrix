const crypto = require('crypto');
const { env } = require('../config');
const { sendError } = require('../utils/ApiResponse');

const SIGNATURE_HEADERS = ['x-webhook-signature', 'x-whatsbox-signature', 'x-signature'];
const TOKEN_HEADERS = ['x-webhook-secret'];

/**
 * Constant-time comparison of two strings.
 */
function safeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Verifies an HMAC-SHA256 signature over the raw request body.
 * Accepts hex (64 chars) and base64 encodings, with optional sha256= prefix.
 */
function verifyHmac(rawBody, signature, secret) {
  if (!signature || !Buffer.isBuffer(rawBody)) return false;

  const cleaned = String(signature).replace(/^sha256=/i, '').trim();
  if (!cleaned) return false;

  let decoded;
  if (/^[a-f0-9]{64}$/i.test(cleaned)) {
    decoded = Buffer.from(cleaned, 'hex');
  } else {
    try {
      decoded = Buffer.from(cleaned, 'base64');
    } catch {
      return false;
    }
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return expected.length === decoded.length && crypto.timingSafeEqual(expected, decoded);
}

/**
 * Webhook verification middleware.
 * Requires req.body to be the RAW body Buffer (mount express.raw first).
 *
 * Accepted credentials (in order):
 *   1. HMAC signature in a signature header (recommended)
 *   2. Secret token via `x-webhook-secret` header or `?secret=` query param
 */
function webhookAuth(req, res, next) {
  const secret = env.WHATSBOX_WEBHOOK_SECRET;

  if (!secret || String(secret).trim() === '') {
    req.webhookVerified = false;
    return next();
  }

  const signature = SIGNATURE_HEADERS.map((h) => req.get(h)).find(Boolean);
  if (signature && verifyHmac(req.body, signature, secret)) {
    req.webhookVerified = true;
    return next();
  }

  const token = TOKEN_HEADERS.map((h) => req.get(h)).find(Boolean) || req.query.secret;
  if (token && safeEqualStr(token, secret)) {
    req.webhookVerified = true;
    return next();
  }

  return sendError(res, 'Invalid webhook signature', 401);
}

/**
 * GET verification for the classic hub.challenge handshake (used by
 * Meta-style webhook subscriptions). Echoes the challenge when the
 * verify_token matches the configured webhook secret.
 */
function verifyHubChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && env.WHATSBOX_WEBHOOK_SECRET && safeEqualStr(token, env.WHATSBOX_WEBHOOK_SECRET)) {
    res.type('text/plain').send(String(challenge));
    return;
  }

  return sendError(res, 'Verification failed', 403);
}

module.exports = webhookAuth;
module.exports.verifyHubChallenge = verifyHubChallenge;
module.exports.verifyHmac = verifyHmac;
module.exports.safeEqualStr = safeEqualStr;
