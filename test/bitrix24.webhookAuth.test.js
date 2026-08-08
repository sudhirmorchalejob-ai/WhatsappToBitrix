const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyBitrix24Webhook } = require('../src/webhooks/bitrix24/webhookAuth');

function makeInstall(overrides = {}) {
  return {
    memberId: 'm1',
    domain: 'portal.bitrix24.com',
    applicationToken: 'apptok',
    accessToken: 'access-1',
    ...overrides,
  };
}

function fakeInstallRepo(install) {
  return {
    findByMemberId: async (memberId) => (install && memberId === install.memberId ? install : null),
  };
}

function mockReq(payload) {
  return {
    body: Buffer.from(JSON.stringify(payload)),
    ip: '127.0.0.1',
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
  return res;
}

function auth(memberId = 'm1', applicationToken = 'apptok') {
  return { member_id: memberId, application_token: applicationToken };
}

test('accepts a valid application_token and exposes b24Auth', async () => {
  const verify = createVerifyBitrix24Webhook({ installRepository: fakeInstallRepo(makeInstall()) });
  const req = mockReq({ event: 'ONIMCONNECTORMESSAGEADD', auth: auth() });
  const res = mockRes();
  let nextCalled = false;
  await verify(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(req.b24Auth.memberId, 'm1');
  assert.equal(req.b24Auth.install.memberId, 'm1');
  assert.equal(req.b24Auth.auth.member_id, 'm1');
  assert.equal(req.b24Auth.payload.event, 'ONIMCONNECTORMESSAGEADD');
});

test('rejects a mismatched application_token with 401', async () => {
  const verify = createVerifyBitrix24Webhook({ installRepository: fakeInstallRepo(makeInstall()) });
  const req = mockReq({ event: 'ONIMCONNECTORMESSAGEADD', auth: auth('m1', 'wrong') });
  const res = mockRes();
  await verify(req, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Invalid Bitrix24 webhook application_token');
});

test('rejects an unknown portal with 403', async () => {
  const verify = createVerifyBitrix24Webhook({ installRepository: fakeInstallRepo(makeInstall()) });
  const req = mockReq({ event: 'ONIMCONNECTORMESSAGEADD', auth: auth('ghost') });
  const res = mockRes();
  await verify(req, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 403);
});

test('rejects a payload without member_id with 403', async () => {
  const verify = createVerifyBitrix24Webhook({ installRepository: fakeInstallRepo(makeInstall()) });
  const req = mockReq({ event: 'ONIMCONNECTORMESSAGEADD', auth: {} });
  const res = mockRes();
  await verify(req, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 403);
});

test('rejects a non-JSON body with 400', async () => {
  const verify = createVerifyBitrix24Webhook({ installRepository: fakeInstallRepo(makeInstall()) });
  const req = { body: Buffer.from('not-json'), ip: '127.0.0.1' };
  const res = mockRes();
  await verify(req, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 400);
});

test('rejects when the install has no stored application_token', async () => {
  const verify = createVerifyBitrix24Webhook({
    installRepository: fakeInstallRepo(makeInstall({ applicationToken: null })),
  });
  const req = mockReq({ event: 'ONIMCONNECTORMESSAGEADD', auth: auth() });
  const res = mockRes();
  await verify(req, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 401);
});
