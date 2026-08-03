const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Bitrix24OAuth } = require('../src/services/bitrix24/oauth');
const { Bitrix24ApiError } = require('../src/services/bitrix24/bitrix24.error');
const { env } = require('../src/config');

const originalClientId = env.BITRIX24_CLIENT_ID;
const originalClientSecret = env.BITRIX24_CLIENT_SECRET;
const originalTokenUrl = env.BITRIX24_OAUTH_TOKEN_URL;

function makeInstall(overrides = {}) {
  return {
    memberId: 'abc123',
    domain: 'company.bitrix24.com',
    clientEndpoint: 'https://company.bitrix24.com/rest/',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    applicationToken: 'app-token',
    userId: 1,
    scope: 'crm,im',
    status: 'INSTALLED',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    ...overrides,
  };
}

function fakeInstallRepo(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, v]));
  const calls = { upsert: [], updateTokens: [], markDisabled: [] };
  return {
    calls,
    store,
    async upsert(input) {
      calls.upsert.push(input);
      const row = makeInstall(input);
      store.set(input.memberId, row);
      return row;
    },
    async findByMemberId(memberId) {
      return store.get(memberId) || null;
    },
    async updateTokens(memberId, data) {
      calls.updateTokens.push({ memberId, data });
      const existing = store.get(memberId) || makeInstall({ memberId });
      const row = { ...existing, ...data };
      store.set(memberId, row);
      return row;
    },
    async markUninstalled(memberId) {
      const row = { ...store.get(memberId), status: 'UNINSTALLED' };
      store.set(memberId, row);
      return row;
    },
    async markDisabled(memberId) {
      calls.markDisabled.push(memberId);
      const row = { ...store.get(memberId), status: 'DISABLED' };
      store.set(memberId, row);
      return row;
    },
    async findActiveMostRecent() {
      return store.values().next().value || null;
    },
  };
}

function fakeHttp(responses = []) {
  const calls = [];
  return {
    calls,
    async post(url, body, options) {
      calls.push({ url, body: body.toString(), options });
      const next = responses.shift();
      if (next && next.throw) throw next.throw;
      return { data: next && next.data };
    },
  };
}

before(() => {
  env.BITRIX24_CLIENT_ID = 'client-123';
  env.BITRIX24_CLIENT_SECRET = 'secret-456';
  env.BITRIX24_OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/';
});

after(() => {
  env.BITRIX24_CLIENT_ID = originalClientId;
  env.BITRIX24_CLIENT_SECRET = originalClientSecret;
  env.BITRIX24_OAUTH_TOKEN_URL = originalTokenUrl;
});

test('restBaseUrl normalizes a domain', () => {
  const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo() });
  assert.equal(oauth.restBaseUrl('company.bitrix24.com'), 'https://company.bitrix24.com/rest/');
  assert.equal(oauth.restBaseUrl('https://company.bitrix24.com/'), 'https://company.bitrix24.com/rest/');
});

test('installFromEvent normalizes the event auth payload', async () => {
  const repo = fakeInstallRepo();
  const oauth = new Bitrix24OAuth({ installRepository: repo });
  const row = await oauth.installFromEvent({
    access_token: 'tok-1',
    refresh_token: 'ref-1',
    member_id: 'm1',
    domain: 'portal.bitrix24.com',
    client_endpoint: 'https://portal.bitrix24.com/rest/',
    application_token: 'apptok',
    scope: 'crm,im',
    expires_in: 7200,
  });
  assert.equal(row.memberId, 'm1');
  assert.equal(row.domain, 'portal.bitrix24.com');
  assert.equal(row.applicationToken, 'apptok');
  assert.equal(repo.calls.upsert.length, 1);
  const stored = repo.calls.upsert[0];
  assert.equal(stored.accessToken, 'tok-1');
  assert.equal(stored.refreshToken, 'ref-1');
  assert.ok(stored.expiresAt > new Date(Date.now() + 7000 * 1000));
});

test('installFromEvent rejects an incomplete auth payload', async () => {
  const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo() });
  await assert.rejects(() => oauth.installFromEvent({ member_id: 'm1' }), /missing/);
});

test('installFromParams handles uppercase portal keys', async () => {
  const repo = fakeInstallRepo();
  const oauth = new Bitrix24OAuth({ installRepository: repo });
  const row = await oauth.installFromParams({
    member_id: 'm2',
    AUTH_ID: 'auth-2',
    REFRESH_ID: 'refresh-2',
    DOMAIN: 'portal2.bitrix24.com',
    AUTH_EXPIRES: '1800',
  });
  assert.equal(row.memberId, 'm2');
  assert.equal(row.accessToken, 'auth-2');
  assert.equal(row.refreshToken, 'refresh-2');
  assert.equal(row.clientEndpoint, 'https://portal2.bitrix24.com/rest/');
  const stored = repo.calls.upsert[0];
  assert.ok(stored.expiresAt > new Date(Date.now() + 1500 * 1000));
});

test('installFromParams rejects without member_id/AUTH_ID', async () => {
  const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo() });
  await assert.rejects(() => oauth.installFromParams({ member_id: 'm3' }), /AUTH_ID/);
});

test('exchangeCode posts authorization_code and persists userId', async () => {
  const repo = fakeInstallRepo();
  const http = fakeHttp([
    { data: { access_token: 'ac', refresh_token: 'rf', expires_in: 3600, member_id: 'm4', user_id: 9, domain: 'portal4.bitrix24.com', status: 'T', scope: 'app' } },
  ]);
  const oauth = new Bitrix24OAuth({ installRepository: repo, http });
  const row = await oauth.exchangeCode({ code: 'code-1', domain: 'portal4.bitrix24.com' });

  assert.equal(row.memberId, 'm4');
  assert.equal(row.userId, 9);
  assert.equal(row.accessToken, 'ac');
  assert.equal(http.calls.length, 1);
  assert.match(http.calls[0].url, /oauth\.bitrix\.info\/oauth\/token/);
  assert.match(http.calls[0].body, /grant_type=authorization_code/);
  assert.match(http.calls[0].body, /client_id=client-123/);
  assert.match(http.calls[0].body, /client_secret=secret-456/);
  assert.match(http.calls[0].body, /code=code-1/);
});

test('exchangeCode requires configured client credentials', async () => {
  env.BITRIX24_CLIENT_ID = '';
  try {
    const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo(), http: fakeHttp([]) });
    await assert.rejects(() => oauth.exchangeCode({ code: 'x', domain: 'd.bitrix24.com' }), /BITRIX24_CLIENT_ID/);
  } finally {
    env.BITRIX24_CLIENT_ID = 'client-123';
  }
});

test('refreshTokens rotates the pair via refresh_token grant', async () => {
  const repo = fakeInstallRepo();
  repo.store.set('abc123', makeInstall());
  const http = fakeHttp([
    { data: { access_token: 'ac-new', refresh_token: 'rf-new', expires_in: 3600, status: 'T' } },
  ]);
  const oauth = new Bitrix24OAuth({ installRepository: repo, http });
  const row = await oauth.refreshTokens('abc123');

  assert.equal(row.accessToken, 'ac-new');
  assert.equal(row.refreshToken, 'rf-new');
  assert.equal(http.calls.length, 1);
  assert.match(http.calls[0].body, /grant_type=refresh_token/);
  assert.match(http.calls[0].body, /refresh_token=refresh-token/);
  const update = repo.calls.updateTokens[0];
  assert.equal(update.data.accessToken, 'ac-new');
});

test('refreshTokens rejects for an unknown portal', async () => {
  const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo(), http: fakeHttp([]) });
  await assert.rejects(() => oauth.refreshTokens('nope'), /not found/i);
});

test('refreshTokens disables the install on invalid_grant', async () => {
  const repo = fakeInstallRepo();
  repo.store.set('abc123', makeInstall());
  const err = new Bitrix24ApiError('bad refresh', 'invalid_grant', 502, { error: 'invalid_grant' });
  const http = fakeHttp([{ throw: err }]);
  const oauth = new Bitrix24OAuth({ installRepository: repo, http });
  await assert.rejects(() => oauth.refreshTokens('abc123'), { code: 'invalid_grant' });
  assert.deepEqual(repo.calls.markDisabled, ['abc123']);
});

test('refreshTokens maps a network failure to OAUTH_NETWORK_ERROR', async () => {
  const repo = fakeInstallRepo();
  repo.store.set('abc123', makeInstall());
  const http = fakeHttp([{ throw: { code: 'ECONNRESET', message: 'reset', response: undefined } }]);
  const oauth = new Bitrix24OAuth({ installRepository: repo, http });
  await assert.rejects(() => oauth.refreshTokens('abc123'), { code: 'OAUTH_NETWORK_ERROR' });
});

test('verifyApplicationToken matches in constant-time, rejects mismatches', () => {
  const oauth = new Bitrix24OAuth({ installRepository: fakeInstallRepo() });
  const install = makeInstall({ applicationToken: 'secret-token' });
  assert.equal(oauth.verifyApplicationToken(install, 'secret-token'), true);
  assert.equal(oauth.verifyApplicationToken(install, 'wrong'), false);
  assert.equal(oauth.verifyApplicationToken(null, 'secret-token'), false);
  assert.equal(oauth.verifyApplicationToken(makeInstall({ applicationToken: null }), 'secret-token'), false);
});
