const { test } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const { InstallController } = require('../src/controllers/install.controller');

function mockReq({ query = {}, body = null, ip = '127.0.0.1' }) {
  return { query, body, ip };
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

function makeInstall(overrides = {}) {
  return {
    memberId: 'm1',
    domain: 'portal.bitrix24.com',
    clientEndpoint: 'https://portal.bitrix24.com/rest/',
    accessToken: '0123456789abcdef',
    refreshToken: 'abcdef0123456789',
    applicationToken: 'apptok',
    userId: 1,
    scope: 'crm,im',
    status: 'INSTALLED',
    expiresAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function createFakes(overrides = {}) {
  const calls = { activate: [], confirm: 0, bind: 0, provision: [], uninstalled: [], logs: [] };

  const installRepo = {
    findByMemberId: async (memberId) => (memberId === 'm1' ? makeInstall() : null),
    markUninstalled: async (memberId) => {
      calls.uninstalled.push(memberId);
      return makeInstall({ status: 'UNINSTALLED' });
    },
    list: async () => [makeInstall()],
  };

  const webhookLogRepo = {
    create: async (log) => {
      calls.logs.push(log);
      return { id: calls.logs.length };
    },
  };

  const bitrix24Service = {
    oauth: {
      installFromEvent: overrides.installFromEvent || (async () => makeInstall()),
      installFromParams: overrides.installFromParams || (async () => makeInstall()),
      verifyApplicationToken: (install, token) => Boolean(install && install.applicationToken === token),
    },
    oauthCtx: null,
    client: null,
    activate(memberId) {
      calls.activate.push(memberId);
    },
    async confirmInstall() {
      calls.confirm += 1;
    },
    async bindEvents() {
      calls.bind += 1;
      return [{ event: 'ONAPPUNINSTALL', ok: true }];
    },
  };

  const connectorService = {
    provision: overrides.provision || (async (memberId) => {
      calls.provision.push(memberId);
      return { memberId, register: { ok: true }, bindings: [], activation: null, error: null };
    }),
  };

  const controller = new InstallController({ installRepo, webhookLogRepo, bitrix24Service, connectorService });
  return { controller, calls, installRepo, webhookLogRepo, bitrix24Service, connectorService };
}

const eventAuth = {
  access_token: 'ac',
  refresh_token: 'rf',
  member_id: 'm1',
  domain: 'portal.bitrix24.com',
  application_token: 'apptok',
};

test('GET /install persists params and renders the success page', async () => {
  const { controller, calls } = createFakes();
  const req = mockReq({ query: { member_id: 'm1', AUTH_ID: 'ac', REFRESH_ID: 'rf', DOMAIN: 'portal.bitrix24.com' } });
  const res = mockRes();
  await controller.install(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.body), /portal\.bitrix24\.com/);
  assert.deepEqual(calls.activate, ['m1']);
  assert.equal(calls.confirm, 1);
  assert.equal(calls.bind, 1);
  assert.deepEqual(calls.provision, ['m1'], 'connector is provisioned after install');
});

test('POST /install event stores tokens and returns the install', async () => {
  const { controller, calls } = createFakes();
  const req = mockReq({ body: { event: 'ONAPPINSTALL', auth: eventAuth } });
  const res = mockRes();
  await controller.installEvent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.memberId, 'm1');
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].source, 'BITRIX24');
  assert.equal(calls.logs[0].status, 'PROCESSED');
  assert.deepEqual(calls.provision, ['m1'], 'connector is provisioned on event install');
});

test('POST /install succeeds even when connector provisioning fails', async () => {
  const { controller, calls } = createFakes({
    provision: async (memberId) => {
      calls.provision.push(memberId);
      throw new Error('register exploded');
    },
  });
  const req = mockReq({ body: { event: 'ONAPPINSTALL', auth: eventAuth } });
  const res = mockRes();
  await controller.installEvent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.memberId, 'm1');
  assert.deepEqual(calls.provision, ['m1'], 'provisioning attempted and swallowed');
});

test('POST /install event failure is logged and surfaced', async () => {
  const { controller, calls } = createFakes({
    installFromEvent: async () => {
      throw new AppError('missing tokens', 400, null, 'B24_INSTALL_INVALID');
    },
  });
  const req = mockReq({ body: { event: 'ONAPPINSTALL', auth: {} } });
  const res = mockRes();
  await controller.installEvent(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].status, 'FAILED');
  assert.match(calls.logs[0].errorMessage, /missing tokens/);
});

test('POST /uninstall with a valid application_token cleans up', async () => {
  const { controller, calls } = createFakes();
  const req = mockReq({ body: { event: 'ONAPPUNINSTALL', auth: { member_id: 'm1', application_token: 'apptok' } } });
  const res = mockRes();
  await controller.uninstall(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.uninstalled, true);
  assert.deepEqual(calls.uninstalled, ['m1']);
  assert.equal(calls.logs[0].status, 'PROCESSED');
});

test('POST /uninstall with a mismatched application_token is rejected', async () => {
  const { controller, calls } = createFakes();
  const req = mockReq({ body: { event: 'ONAPPUNINSTALL', auth: { member_id: 'm1', application_token: 'wrong' } } });
  const res = mockRes();
  await controller.uninstall(req, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(calls.uninstalled, []);
  assert.equal(calls.logs[0].status, 'FAILED');
});

test('POST /uninstall for an unknown portal is idempotent', async () => {
  const { controller, calls } = createFakes();
  const req = mockReq({ body: { event: 'ONAPPUNINSTALL', auth: { member_id: 'ghost', application_token: 'x' } } });
  const res = mockRes();
  await controller.uninstall(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.alreadyGone, true);
  assert.deepEqual(calls.uninstalled, []);
});

test('POST /uninstall without member_id is rejected', async () => {
  const { controller } = createFakes();
  const req = mockReq({ body: { event: 'ONAPPUNINSTALL', auth: {} } });
  const res = mockRes();
  await controller.uninstall(req, res);
  assert.equal(res.statusCode, 400);
});

test('GET /app/settings masks the token material', async () => {
  const { controller } = createFakes();
  const req = mockReq({ query: { member_id: 'm1' } });
  const res = mockRes();
  await controller.settings(req, res);
  assert.equal(res.statusCode, 200);
  const row = res.body.data[0];
  assert.equal(row.memberId, 'm1');
  assert.equal(row.tokens.accessToken, '0123…cdef');
  assert.notEqual(row.tokens.accessToken, '0123456789abcdef');
  assert.equal(row.tokens.refreshToken, 'abcd…6789');
});
