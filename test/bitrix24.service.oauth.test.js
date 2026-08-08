const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config');
const { Bitrix24Service } = require('../src/services/bitrix24/bitrix24.service');

const originalMemberId = env.BITRIX24_MEMBER_ID;
const originalWebhookUrl = env.BITRIX24_WEBHOOK_URL;
const originalAppBaseUrl = env.APP_BASE_URL;

function makeInstall(overrides = {}) {
  return {
    memberId: 'm1',
    domain: 'portal.bitrix24.com',
    clientEndpoint: 'https://portal.bitrix24.com/rest/',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    applicationToken: 'apptok',
    userId: null,
    scope: 'app',
    status: 'INSTALLED',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    ...overrides,
  };
}

function fakeInstallRepo(install) {
  const store = new Map();
  if (install) store.set(install.memberId, install);
  return {
    store,
    async findByMemberId(memberId) {
      return store.get(memberId) || null;
    },
    async findActiveMostRecent() {
      for (const row of store.values()) if (row.status === 'INSTALLED') return row;
      return null;
    },
    async updateTokens(memberId, data) {
      const row = { ...store.get(memberId), ...data };
      store.set(memberId, row);
      return row;
    },
  };
}

function fakeOAuth({ refreshResult } = {}) {
  return {
    restBaseUrl: (domain) => `https://${domain}/rest/`,
    async refreshTokens(memberId) {
      return refreshResult(memberId);
    },
  };
}

function stubRestCall(client, responses) {
  const posted = [];
  client.http.post = async (url, body) => {
    posted.push({ url, body });
    const next = responses.shift();
    if (next && next.throw) throw next.throw;
    return { data: next.data };
  };
  return posted;
}

before(() => {
  env.BITRIX24_MEMBER_ID = 'm1';
  env.BITRIX24_WEBHOOK_URL = '';
  env.APP_BASE_URL = 'https://app.example.com';
});

after(() => {
  env.BITRIX24_MEMBER_ID = originalMemberId;
  env.BITRIX24_WEBHOOK_URL = originalWebhookUrl;
  env.APP_BASE_URL = originalAppBaseUrl;
});

test('isConfigured is true when a member is pinned in env', () => {
  const service = new Bitrix24Service({ installRepository: fakeInstallRepo() });
  assert.equal(service.isConfigured(), true);
});

test('isConfigured is false when nothing is configured', () => {
  env.BITRIX24_MEMBER_ID = '';
  try {
    const service = new Bitrix24Service({ installRepository: fakeInstallRepo() });
    assert.equal(service.isConfigured(), false);
  } finally {
    env.BITRIX24_MEMBER_ID = 'm1';
  }
});

test('_ensureConfigured builds an OAuth client from the install', async () => {
  const service = new Bitrix24Service({
    installRepository: fakeInstallRepo(makeInstall()),
    oauth: fakeOAuth(),
  });
  const client = await service._ensureConfigured();
  assert.equal(client.http.defaults.baseURL, 'https://portal.bitrix24.com/rest/');
  assert.equal(client.accessToken, 'access-1');
});

test('_ensureConfigured throws B24_NOT_INSTALLED when the portal is unknown', async () => {
  const service = new Bitrix24Service({ installRepository: fakeInstallRepo() });
  await assert.rejects(() => service._ensureConfigured(), (err) => err.code === 'B24_NOT_INSTALLED');
});

test('_ensureConfigured refreshes the token when it is about to expire', async () => {
  const install = makeInstall({ expiresAt: new Date(Date.now() - 1000) });
  const repo = fakeInstallRepo(install);
  const service = new Bitrix24Service({
    installRepository: repo,
    oauth: fakeOAuth({
      refreshResult: async () => {
        repo.store.set('m1', makeInstall({ accessToken: 'access-rotated', refreshToken: 'refresh-rotated' }));
        return repo.store.get('m1');
      },
    }),
  });
  const client = await service._ensureConfigured();
  assert.equal(client.accessToken, 'access-rotated');
  assert.equal(repo.store.get('m1').refreshToken, 'refresh-rotated');
});

test('_ensureConfigured falls back to the legacy webhook URL client', async () => {
  env.BITRIX24_MEMBER_ID = '';
  env.BITRIX24_WEBHOOK_URL = 'https://company.bitrix24.com/rest/1/test/';
  try {
    const service = new Bitrix24Service({ installRepository: fakeInstallRepo() });
    const client = await service._ensureConfigured();
    assert.equal(client.http.defaults.baseURL, 'https://company.bitrix24.com/rest/1/test/');
    assert.equal(client.accessToken, null);
  } finally {
    env.BITRIX24_MEMBER_ID = 'm1';
    env.BITRIX24_WEBHOOK_URL = '';
  }
});

test('confirmInstall stores the app user id from app.info', async () => {
  const repo = fakeInstallRepo(makeInstall());
  const service = new Bitrix24Service({ installRepository: repo, oauth: fakeOAuth() });
  const client = await service._ensureConfigured();
  stubRestCall(client, [{ data: { result: { USER_ID: 42, DOMAIN: 'portal.bitrix24.com' } } }]);
  const info = await service.confirmInstall('m1');
  assert.equal(info.USER_ID, 42);
  assert.equal(repo.store.get('m1').userId, 42);
});

test('bindEvents registers the uninstall handler', async () => {
  const repo = fakeInstallRepo(makeInstall());
  const service = new Bitrix24Service({ installRepository: repo, oauth: fakeOAuth() });
  const client = await service._ensureConfigured();
  const posted = stubRestCall(client, [{ data: { result: true } }]);
  const results = await service.bindEvents('m1');
  assert.equal(results[0].event, 'ONAPPUNINSTALL');
  assert.equal(results[0].ok, true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'event.bind.json');
  assert.equal(posted[0].body.event, 'ONAPPUNINSTALL');
  assert.equal(posted[0].body.handler, 'https://app.example.com/uninstall');
  assert.equal(posted[0].body.auth, 'access-1');
});

test('bindEvents reports non-fatal bind errors instead of throwing', async () => {
  const repo = fakeInstallRepo(makeInstall());
  const service = new Bitrix24Service({ installRepository: repo, oauth: fakeOAuth() });
  const client = await service._ensureConfigured();
  stubRestCall(client, [{ throw: Object.assign(new Error('boom'), { code: 'UNKNOWN', message: 'boom' }) }]);
  const results = await service.bindEvents('m1');
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /boom/);
});

test('activate pins the service to a portal without env', async () => {
  env.BITRIX24_MEMBER_ID = '';
  try {
    const service = new Bitrix24Service({
      installRepository: fakeInstallRepo(makeInstall()),
      oauth: fakeOAuth(),
    });
    service.activate('m1');
    const client = await service._ensureConfigured();
    assert.equal(client.accessToken, 'access-1');
  } finally {
    env.BITRIX24_MEMBER_ID = 'm1';
  }
});
