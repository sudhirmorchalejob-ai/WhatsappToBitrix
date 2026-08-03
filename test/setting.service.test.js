const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SettingService } = require('../src/services/setting.service');

// ------------------------------------------------------------------ fakes

function createFakes(seed = []) {
  const rows = new Map();
  for (const r of seed) rows.set(r.key, { ...r });

  const settingRepo = {
    get: async (key) => (rows.get(key) ? rows.get(key).value : null),
    getRaw: async (key) => rows.get(key) || null,
    set: async (key, value, opts = {}) => {
      const row = { key, value, ...opts };
      rows.set(key, row);
      return row;
    },
    remove: async (key) => {
      rows.delete(key);
    },
    list: async ({ includeSecrets = false } = {}) =>
      Array.from(rows.values()).map((r) => {
        const pub = { ...r };
        if (r.isSecret && !includeSecrets) pub.value = '********';
        return pub;
      }),
  };

  const service = new SettingService({ settingRepo });
  return { service, settingRepo, rows };
}

// ------------------------------------------------------------------ set/get

test('set stores strings, numbers, booleans and json per their type', async () => {
  const { service, rows } = createFakes();

  await service.set({ key: 'greeting', value: 'hello', type: 'string' });
  await service.set({ key: 'pageSize', value: '25', type: 'number' });
  await service.set({ key: 'notify', value: 'true', type: 'boolean' });
  await service.set({ key: 'meta', value: { a: 1 }, type: 'json' });

  assert.equal(rows.get('greeting').value, 'hello');
  assert.equal(rows.get('pageSize').value, 25);
  assert.equal(rows.get('notify').value, true);
  assert.deepEqual(rows.get('meta').value, { a: 1 });
});

test('set rejects a value that does not match its declared type', async () => {
  const { service } = createFakes();

  await assert.rejects(
    () => service.set({ key: 'bad', value: 42, type: 'string' }),
    (err) => err.code === 'INVALID_SETTING_VALUE'
  );
  await assert.rejects(
    () => service.set({ key: 'bad', value: 'abc', type: 'number' }),
    (err) => err.code === 'INVALID_SETTING_VALUE'
  );
  await assert.rejects(
    () => service.set({ key: 'bad', value: 'yes', type: 'boolean' }),
    (err) => err.code === 'INVALID_SETTING_VALUE'
  );
});

test('set rejects an unknown type', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.set({ key: 'x', value: 'y', type: 'datetime' }),
    (err) => err.code === 'INVALID_SETTING_TYPE'
  );
});

test('getValue returns the stored value or the fallback', async () => {
  const { service } = createFakes([{ key: 'existing', value: 'yes' }]);

  assert.equal(await service.getValue('existing'), 'yes');
  assert.equal(await service.getValue('missing', 'default'), 'default');
  assert.equal(await service.getValue('missing'), null);
});

// ------------------------------------------------------------------ remove

test('remove deletes an existing setting', async () => {
  const { service, rows } = createFakes([{ key: 'k', value: 'v' }]);
  assert.equal(await service.remove('k'), true);
  assert.equal(rows.has('k'), false);
});

test('remove throws 404 for an unknown key', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.remove('nope'),
    (err) => err.code === 'SETTING_NOT_FOUND' && err.statusCode === 404
  );
});

// ------------------------------------------------------------------ list

test('list masks secret values by default', async () => {
  const { service } = createFakes([
    { key: 'public', value: 'x' },
    { key: 'token', value: 'super-secret', isSecret: true },
  ]);

  const rows = await service.list();
  assert.equal(rows.find((r) => r.key === 'public').value, 'x');
  assert.equal(rows.find((r) => r.key === 'token').value, '********');
});

test('list exposes secrets only when explicitly requested', async () => {
  const { service } = createFakes([{ key: 'token', value: 'super-secret', isSecret: true }]);

  const rows = await service.list({ includeSecrets: true });
  assert.equal(rows[0].value, 'super-secret');
});
