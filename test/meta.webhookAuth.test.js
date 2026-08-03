const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifyMetaWebhook, verifyMetaChallenge } = require('../src/webhooks/meta/webhookAuth');
const { env } = require('../src/config');

const SECRET = 'meta-app-secret';
const originalSecret = env.META_APP_SECRET;
const originalVerifyToken = env.META_WEBHOOK_VERIFY_TOKEN;
const originalNodeEnv = env.NODE_ENV;

function mockReq({ headers = {}, query = {}, body }) {
  return {
    body,
    query,
    ip: '127.0.0.1',
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.type = () => res;
  return res;
}

function metaSignature(body, secret = SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

before(() => {
  env.META_APP_SECRET = SECRET;
  env.META_WEBHOOK_VERIFY_TOKEN = 'meta-verify-token';
});

after(() => {
  env.META_APP_SECRET = originalSecret;
  env.META_WEBHOOK_VERIFY_TOKEN = originalVerifyToken;
  env.NODE_ENV = originalNodeEnv;
});

test('accepts a valid X-Hub-Signature-256 over the raw body', () => {
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const req = mockReq({ headers: { 'x-hub-signature-256': metaSignature(body) }, body });
  const res = mockRes();
  let nextCalled = false;
  verifyMetaWebhook(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.webhookVerified, true);
});

test('rejects a tampered signature with 401', () => {
  const body = Buffer.from('raw-body');
  const req = mockReq({ headers: { 'x-hub-signature-256': metaSignature(body, 'wrong-secret') }, body });
  const res = mockRes();
  verifyMetaWebhook(req, res, () => assert.fail('should not pass'));
  assert.strictEqual(res.statusCode, 401);
});

test('rejects when no signature header is present', () => {
  const req = mockReq({ body: Buffer.from('raw-body') });
  const res = mockRes();
  verifyMetaWebhook(req, res, () => assert.fail('should not pass'));
  assert.strictEqual(res.statusCode, 401);
});

test('dev mode: missing META_APP_SECRET passes through with warning flag', () => {
  env.NODE_ENV = 'development';
  env.META_APP_SECRET = '';
  const req = mockReq({ body: Buffer.from('raw-body') });
  const res = mockRes();
  let nextCalled = false;
  verifyMetaWebhook(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.webhookVerified, false);
  env.META_APP_SECRET = SECRET;
});

test('production mode: missing META_APP_SECRET blocks with 503', () => {
  env.NODE_ENV = 'production';
  env.META_APP_SECRET = '';
  const req = mockReq({ body: Buffer.from('raw-body') });
  const res = mockRes();
  verifyMetaWebhook(req, res, () => assert.fail('should block'));
  assert.strictEqual(res.statusCode, 503);
  env.META_APP_SECRET = SECRET;
  env.NODE_ENV = 'development';
});

test('hub.challenge echoes challenge on matching verify token', () => {
  const req = mockReq({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'meta-verify-token', 'hub.challenge': 'challenge-123' } });
  const res = mockRes();
  verifyMetaChallenge(req, res);
  assert.strictEqual(res.body, 'challenge-123');
});

test('hub.challenge rejects mismatched token with 403', () => {
  const req = mockReq({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc' } });
  const res = mockRes();
  verifyMetaChallenge(req, res);
  assert.strictEqual(res.statusCode, 403);
});

test('hub.challenge rejects non-subscribe mode', () => {
  const req = mockReq({ query: { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'meta-verify-token', 'hub.challenge': 'abc' } });
  const res = mockRes();
  verifyMetaChallenge(req, res);
  assert.strictEqual(res.statusCode, 403);
});

test('hub.challenge rejects when verify token is not configured', () => {
  env.META_WEBHOOK_VERIFY_TOKEN = '';
  const req = mockReq({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'meta-verify-token', 'hub.challenge': 'abc' } });
  const res = mockRes();
  verifyMetaChallenge(req, res);
  assert.strictEqual(res.statusCode, 403);
  env.META_WEBHOOK_VERIFY_TOKEN = 'meta-verify-token';
});
