const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const webhookAuth = require('../src/middlewares/webhookAuth');
const { env } = require('../src/config');

const SECRET = 'tok';
const originalSecret = env.WHATSBOX_WEBHOOK_SECRET;
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

before(() => {
  env.WHATSBOX_WEBHOOK_SECRET = SECRET;
});

after(() => {
  env.WHATSBOX_WEBHOOK_SECRET = originalSecret;
  env.NODE_ENV = originalNodeEnv;
});

test('verifies a valid HMAC hex signature', () => {
  const body = Buffer.from(JSON.stringify({ event: 'test' }));
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

  const req = mockReq({ headers: { 'x-webhook-signature': signature }, body });
  const res = mockRes();
  let nextCalled = false;
  webhookAuth(req, res, () => (nextCalled = true));

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.webhookVerified, true);
});

test('verifies sha256= prefixed base64 signature', () => {
  const body = Buffer.from('raw-body');
  const signature = `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('base64')}`;

  const req = mockReq({ headers: { 'x-signature': signature }, body });
  const res = mockRes();
  let nextCalled = false;
  webhookAuth(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
});

test('rejects a tampered signature with 401', () => {
  const body = Buffer.from('raw-body');
  const signature = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');

  const req = mockReq({ headers: { 'x-webhook-signature': signature }, body });
  const res = mockRes();
  webhookAuth(req, res, () => assert.fail('should not pass'));
  assert.strictEqual(res.statusCode, 401);
});

test('accepts secret token via header', () => {
  const req = mockReq({ headers: { 'x-webhook-secret': SECRET }, body: Buffer.from('x') });
  const res = mockRes();
  let nextCalled = false;
  webhookAuth(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
});

test('accepts secret token via query param', () => {
  const req = mockReq({ query: { secret: SECRET }, body: Buffer.from('x') });
  const res = mockRes();
  let nextCalled = false;
  webhookAuth(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
});

test('rejects wrong token with 401', () => {
  const req = mockReq({ query: { secret: 'wrong' }, body: Buffer.from('x') });
  const res = mockRes();
  webhookAuth(req, res, () => assert.fail('should not pass'));
  assert.strictEqual(res.statusCode, 401);
});

test('dev mode: missing secret passes through with warning flag', () => {
  env.NODE_ENV = 'development';
  env.WHATSBOX_WEBHOOK_SECRET = '';
  const req = mockReq({ body: Buffer.from('x') });
  const res = mockRes();
  let nextCalled = false;
  webhookAuth(req, res, () => (nextCalled = true));
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.webhookVerified, false);
  env.WHATSBOX_WEBHOOK_SECRET = SECRET;
});

test('production mode: missing secret blocks with 503', () => {
  env.NODE_ENV = 'production';
  env.WHATSBOX_WEBHOOK_SECRET = '';
  const req = mockReq({ body: Buffer.from('x') });
  const res = mockRes();
  webhookAuth(req, res, () => assert.fail('should block'));
  assert.strictEqual(res.statusCode, 503);
  env.WHATSBOX_WEBHOOK_SECRET = SECRET;
  env.NODE_ENV = 'development';
});

test('hub.challenge echoes challenge on matching token', () => {
  const req = mockReq({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': SECRET, 'hub.challenge': 'abc123' } });
  const res = mockRes();
  webhookAuth.verifyHubChallenge(req, res);
  assert.strictEqual(res.body, 'abc123');
});

test('hub.challenge rejects mismatched token', () => {
  const req = mockReq({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc' } });
  const res = mockRes();
  webhookAuth.verifyHubChallenge(req, res);
  assert.strictEqual(res.statusCode, 403);
});
