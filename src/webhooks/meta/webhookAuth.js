const { env } = require('../../config');
const { sendError } = require('../../utils/ApiResponse');
const { verifyHmac, safeEqualStr } = require('../../middlewares/webhookAuth');

/**
 * Meta Cloud API webhook verification.
 *
 * POST: Meta signs the raw body with `X-Hub-Signature-256:
 * sha256=<hex>` where the HMAC key is the Meta App Secret. Requires
 * req.body to be the RAW body Buffer (mount express.raw first).
 *
 * GET: classic hub.challenge subscription handshake; the verify token
 * is the arbitrary value configured in the Meta app's webhook settings.
 */

function verifyMetaWebhook(req, res, next) {
  const secret = env.META_APP_SECRET;

  if (!secret) {
    if (env.NODE_ENV === 'production') {
      return sendError(res, 'META_APP_SECRET is not configured', 503);
    }
    req.webhookVerified = false;
    return next();
  }

  const signature = req.get('x-hub-signature-256');
  if (signature && verifyHmac(req.body, signature, secret)) {
    req.webhookVerified = true;
    return next();
  }

  return sendError(res, 'Invalid Meta webhook signature', 401);
}

function verifyMetaChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token &&
    env.META_WEBHOOK_VERIFY_TOKEN &&
    safeEqualStr(token, env.META_WEBHOOK_VERIFY_TOKEN)
  ) {
    res.type('text/plain').send(String(challenge));
    return;
  }

  return sendError(res, 'Verification failed', 403);
}

module.exports = { verifyMetaWebhook, verifyMetaChallenge };
