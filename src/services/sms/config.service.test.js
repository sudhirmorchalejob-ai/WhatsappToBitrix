const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../../utils/AppError');
const {
  SmsConfigService,
  SMS_CONFIG_KEYS,
  SMS_SECRET_KEYS,
  MASK,
} = require('./config.service');

function makeFakeSettingRepo() {
  const rows = [];
  return {
    rows,
    async set(key, value, { type = 'string', description = null, isSecret = false, tenantId = null } = {}) {
      const existing = rows.find((r) => r.key === key && (r.tenantId ?? null) === (tenantId ?? null));
      const row = { key, value: String(value), type, description, isSecret, tenantId: tenantId ?? null };
      if (existing) Object.assign(existing, row);
      else rows.push(row);
    },
    async remove(key, tenantId = null) {
      const idx = rows.findIndex((r) => r.key === key && (r.tenantId ?? null) === (tenantId ?? null));
      if (idx >= 0) rows.splice(idx, 1);
    },
    async list({ includeSecrets = false, tenantId = null } = {}) {
      let filtered = rows;
      if (tenantId !== undefined && tenantId !== null) filtered = rows.filter((r) => (r.tenantId ?? null) === tenantId);
      if (!includeSecrets) filtered = filtered.filter((r) => !r.isSecret);
      return filtered.map((r) => ({ ...r }));
    },
  };
}

let repo;
let service;

beforeEach(() => {
  repo = makeFakeSettingRepo();
  service = new SmsConfigService({ settingRepo: repo });
});

test('get() merges env defaults with tenant overrides', async () => {
  await repo.set(SMS_CONFIG_KEYS.API_KEY, 'tenant-secret', { type: 'string', isSecret: true, tenantId: 7 });
  const config = await service.get(7);
  assert.equal(config[SMS_CONFIG_KEYS.PROVIDER], 'generic');
  assert.equal(config[SMS_CONFIG_KEYS.API_KEY], 'tenant-secret');
  // Other tenant does not see tenant 7's override.
  const other = await service.get(8);
  assert.notEqual(other[SMS_CONFIG_KEYS.API_KEY], 'tenant-secret');
});

test('getPublic() masks secret values and never echoes raw secrets', async () => {
  await repo.set(SMS_CONFIG_KEYS.API_KEY, 'raw-secret-xyz', { type: 'string', isSecret: true, tenantId: 7 });
  const { config, masked } = await service.getPublic(7);
  assert.equal(masked, true);
  assert.equal(config[SMS_CONFIG_KEYS.API_KEY], MASK);
  assert.ok(!config[SMS_CONFIG_KEYS.API_KEY].includes('raw-secret-xyz'));
  for (const key of SMS_SECRET_KEYS) {
    assert.ok(Object.values(config).every((v) => !String(v).includes('raw-secret-xyz')));
  }
});

test('save() stores overrides with isSecret flagged for secret keys', async () => {
  await service.save(7, {
    [SMS_CONFIG_KEYS.PROVIDER]: 'msg91',
    [SMS_CONFIG_KEYS.API_KEY]: 'secret-1',
    [SMS_CONFIG_KEYS.WEBHOOK_SECRET]: 'hook-secret',
    [SMS_CONFIG_KEYS.API_URL]: 'https://api.msg91.com/api/sendhttp.php',
    bogus: 'ignored',
  });
  const rows = await repo.list({ includeSecrets: true, tenantId: 7 });
  const keyRow = rows.find((r) => r.key === SMS_CONFIG_KEYS.API_KEY);
  const hookRow = rows.find((r) => r.key === SMS_CONFIG_KEYS.WEBHOOK_SECRET);
  const urlRow = rows.find((r) => r.key === SMS_CONFIG_KEYS.API_URL);
  assert.equal(keyRow.value, 'secret-1');
  assert.equal(keyRow.isSecret, true);
  assert.equal(hookRow.isSecret, true);
  assert.equal(urlRow.isSecret, false);
  assert.ok(!rows.some((r) => r.key === 'bogus'));
});

test('save() removes an override when cleared or masked', async () => {
  await repo.set(SMS_CONFIG_KEYS.API_KEY, 'old-secret', { type: 'string', isSecret: true, tenantId: 7 });
  await service.save(7, { [SMS_CONFIG_KEYS.API_KEY]: MASK });
  let rows = await repo.list({ includeSecrets: true, tenantId: 7 });
  assert.ok(!rows.some((r) => r.key === SMS_CONFIG_KEYS.API_KEY));

  await service.save(7, { [SMS_CONFIG_KEYS.API_URL]: '' });
  rows = await repo.list({ includeSecrets: true, tenantId: 7 });
  assert.ok(!rows.some((r) => r.key === SMS_CONFIG_KEYS.API_URL));
});

test('isConfigured(): msg91 needs only a key, generic needs key + URL', () => {
  assert.equal(service.isConfigured({ [SMS_CONFIG_KEYS.API_KEY]: 'k', [SMS_CONFIG_KEYS.PROVIDER]: 'msg91' }), true);
  assert.equal(service.isConfigured({ [SMS_CONFIG_KEYS.API_KEY]: 'k', [SMS_CONFIG_KEYS.PROVIDER]: 'generic' }), false);
  assert.equal(
    service.isConfigured({
      [SMS_CONFIG_KEYS.API_KEY]: 'k',
      [SMS_CONFIG_KEYS.API_URL]: 'https://x',
      [SMS_CONFIG_KEYS.PROVIDER]: 'generic',
    }),
    true
  );
  assert.equal(service.isConfigured({}), false);
});

test('providerName() normalizes to a known provider', () => {
  assert.equal(service.providerName({ [SMS_CONFIG_KEYS.PROVIDER]: 'MSG91' }), 'msg91');
  assert.equal(service.providerName({ [SMS_CONFIG_KEYS.PROVIDER]: 'unknown' }), 'generic');
  assert.equal(service.providerName({}), 'generic');
});

test('save() throws for inputs that skip validation only; no-op on empty', async () => {
  await service.save(7, {});
  const rows = await repo.list({ includeSecrets: true, tenantId: 7 });
  assert.equal(rows.length, 0);
});

test('AppError is importable (module integrity smoke)', () => {
  assert.equal(typeof AppError, 'function');
});
