const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { InstallRepository, INSTALL_STATUS } = require('../src/repositories/install.repository');

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
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePrisma() {
  const store = new Map();
  const install = {
    upsert: async ({ where, create, update }) => {
      const existing = store.get(where.memberId);
      const row = existing ? { ...existing, ...update, memberId: where.memberId } : { ...create, memberId: where.memberId };
      store.set(where.memberId, row);
      return row;
    },
    findUnique: async ({ where }) => store.get(where.memberId) || null,
    findFirst: async ({ where, orderBy }) => {
      const rows = [...store.values()]
        .filter((r) => !where || !where.status || r.status === where.status)
        .sort((a, b) => new Date(b[orderBy ? Object.keys(orderBy)[0] : 'updatedAt']) - new Date(a[orderBy ? Object.keys(orderBy)[0] : 'updatedAt']));
      return rows[0] || null;
    },
    findMany: async ({ where, orderBy, take }) => {
      const rows = [...store.values()]
        .filter((r) => !where || !where.status || r.status === where.status)
        .sort((a, b) => new Date(b[orderBy ? Object.keys(orderBy)[0] : 'createdAt']) - new Date(a[orderBy ? Object.keys(orderBy)[0] : 'createdAt']))
        .slice(0, take);
      return rows;
    },
    update: async ({ where, data }) => {
      const existing = store.get(where.memberId);
      if (!existing) throw { code: 'P2025' };
      const row = { ...existing, ...data };
      store.set(where.memberId, row);
      return row;
    },
    delete: async ({ where }) => {
      store.delete(where.memberId);
    },
    count: async ({ where }) =>
      [...store.values()].filter((r) => !where || !where.status || r.status === where.status).length,
  };
  return { install, store };
}

before(() => {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
});

after(() => {});

test('upsert creates a row on first install', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  const row = await repo.upsert(makeInstall());
  assert.equal(row.memberId, 'abc123');
  assert.equal(store.size, 1);
  assert.equal(row.accessToken, 'access-token');
});

test('upsert overwrites the same memberId on reinstall', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  await repo.upsert(makeInstall());
  await repo.upsert(makeInstall({ accessToken: 'new-access', refreshToken: 'new-refresh' }));
  assert.equal(store.size, 1);
  assert.equal(store.get('abc123').accessToken, 'new-access');
  assert.equal(store.get('abc123').refreshToken, 'new-refresh');
});

test('findByMemberId returns null for unknown portal', async () => {
  const { install } = fakePrisma();
  const repo = new InstallRepository({ install });
  assert.equal(await repo.findByMemberId('nope'), null);
});

test('findActiveMostRecent only returns INSTALLED portals, newest first', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  store.set('a', makeInstall({ memberId: 'a', status: INSTALL_STATUS.UNINSTALLED, updatedAt: new Date(Date.now() - 1000) }));
  store.set('b', makeInstall({ memberId: 'b', updatedAt: new Date(Date.now() - 2000) }));
  store.set('c', makeInstall({ memberId: 'c', updatedAt: new Date() }));
  const active = await repo.findActiveMostRecent();
  assert.equal(active.memberId, 'c');
});

test('updateTokens rotates access/refresh/expiry', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  store.set('abc123', makeInstall());
  const expiresAt = new Date(Date.now() + 1000);
  const row = await repo.updateTokens('abc123', { accessToken: 'rotated', refreshToken: 'rotated-r', expiresAt, domain: 'new.bitrix24.com' });
  assert.equal(row.accessToken, 'rotated');
  assert.equal(row.refreshToken, 'rotated-r');
  assert.equal(row.expiresAt, expiresAt);
  assert.equal(row.domain, 'new.bitrix24.com');
});

test('markUninstalled flips the status', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  store.set('abc123', makeInstall());
  await repo.markUninstalled('abc123');
  assert.equal(store.get('abc123').status, INSTALL_STATUS.UNINSTALLED);
});

test('remove is idempotent for missing rows', async () => {
  const { install } = fakePrisma();
  const repo = new InstallRepository({ install });
  await repo.remove('missing');
});

test('count filters by status', async () => {
  const { install, store } = fakePrisma();
  const repo = new InstallRepository({ install });
  store.set('a', makeInstall({ memberId: 'a' }));
  store.set('b', makeInstall({ memberId: 'b', status: INSTALL_STATUS.UNINSTALLED }));
  assert.equal(await repo.count(), 2);
  assert.equal(await repo.count({ status: INSTALL_STATUS.INSTALLED }), 1);
});

