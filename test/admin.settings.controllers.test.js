const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettingController } = require('../src/controllers/setting.controller');
const { createAdminController } = require('../src/controllers/admin.controller');

// ------------------------------------------------------------------ helpers

function mockRes() {
  const res = {};
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(body) {
    res.body = body;
    return res;
  };
  return res;
}

function mockReq(partial = {}) {
  return { body: {}, query: {}, params: {}, ...partial };
}

// ---------------------------------------------------------------- settings

test('listSettings returns the settings array', async () => {
  const service = { list: async ({ includeSecrets }) => [{ key: 'a', value: includeSecrets ? 'x' : '********' }] };
  const controller = createSettingController({ service });
  const res = mockRes();

  await controller.listSettings(mockReq({ query: {} }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].value, '********');
});

test('setSetting returns 200 with a masked row for secrets', async () => {
  const service = { set: async () => ({ key: 'token', value: 'real', isSecret: true }) };
  const controller = createSettingController({ service });
  const res = mockRes();

  await controller.setSetting(mockReq({ body: { key: 'token', value: 'real', isSecret: true } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, 'Setting saved');
  assert.equal(res.body.data.value, '********');
});

test('getSetting returns the row and masks secrets', async () => {
  const service = { getRaw: async () => ({ key: 'token', value: 'real', isSecret: true }) };
  const controller = createSettingController({ service });
  const res = mockRes();

  await controller.getSetting(mockReq({ params: { key: 'token' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.value, '********');
});

test('getSetting throws 404 when the setting is missing', async () => {
  const service = { getRaw: async () => null };
  const controller = createSettingController({ service });
  const res = mockRes();

  await assert.rejects(
    () => controller.getSetting(mockReq({ params: { key: 'missing' } }), res),
    (err) => err.code === 'SETTING_NOT_FOUND'
  );
});

test('deleteSetting confirms removal', async () => {
  const service = { remove: async () => true };
  const controller = createSettingController({ service });
  const res = mockRes();

  await controller.deleteSetting(mockReq({ params: { key: 'k' } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { removed: true });
});

// ------------------------------------------------------------------ admin

test('diagnostics returns the overview payload', async () => {
  const service = { overview: async () => ({ db: { ok: true }, counts: {}, providers: {} }) };
  const controller = createAdminController({ service, webhookLogRepo: {} });
  const res = mockRes();

  await controller.diagnostics(mockReq(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.db.ok, true);
});

test('runRetry returns the retry job result', async () => {
  const service = { runRetryNow: async (opts) => ({ scanned: 2, opts }) };
  const controller = createAdminController({ service, webhookLogRepo: {} });
  const res = mockRes();

  await controller.runRetry(mockReq({ query: { limit: 10 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.scanned, 2);
  assert.equal(res.body.data.opts.limit, 10);
});

test('listWebhooks returns rows with pagination meta', async () => {
  const webhookLogRepo = {
    listRecent: async () => [{ id: 1, source: 'WHATSBOX' }],
    count: async () => 25,
  };
  const controller = createAdminController({ service: {}, webhookLogRepo });
  const res = mockRes();

  await controller.listWebhooks(mockReq({ query: { limit: 10, offset: 0 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 1);
  assert.deepEqual(res.body.meta, {
    total: 25,
    limit: 10,
    offset: 0,
    page: 1,
    pages: 3,
    hasMore: true,
  });
});
