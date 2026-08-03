const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ResyncContactsJob } = require('../src/jobs/resyncContacts.job');

// Jobs gate on env config at run time; the repo's .env ships with the
// CRM unset, so tests pin a truthy value (restored by the
// "not configured" test).
const config = require('../src/config');
config.env.BITRIX24_WEBHOOK_URL = config.env.BITRIX24_WEBHOOK_URL || 'https://company.bitrix24.com/rest/1/test/';

// ------------------------------------------------------------------ fakes

function makeContact(overrides = {}) {
  return {
    id: 5,
    whatsappPhone: '15551234567',
    name: 'John',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    syncStatus: 'FAILED',
    ...overrides,
  };
}

function createFakes({ contacts = [] } = {}) {
  const calls = { search: [], create: [], synced: [], failed: [] };

  const contactRepo = {
    findUnsynced: async () => contacts,
    markSynced: async (id, b24Id) => {
      calls.synced.push({ id, b24Id });
      return { id };
    },
    markSyncFailed: async (id, meta) => {
      calls.failed.push({ id, meta });
      return { id };
    },
  };

  const bitrix24 = {
    isConfigured: () => Boolean(config.env.BITRIX24_WEBHOOK_URL || config.env.BITRIX24_MEMBER_ID),
    searchContactByPhone: async (phone) => {
      calls.search.push(phone);
      return null;
    },
    createContact: async (input) => {
      calls.create.push(input);
      return 100;
    },
  };

  const job = new ResyncContactsJob({ contactRepo, bitrix24, intervalMs: 60000 });
  return { job, calls, contactRepo };
}

// --------------------------------------------------------------- tests

test('creates a contact in Bitrix24 and marks it synced', async () => {
  const { job, calls } = createFakes({ contacts: [makeContact()] });
  const result = await job.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].bitrix24ContactId, 100);

  assert.deepEqual(calls.search, ['15551234567']);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].phone, '15551234567');
  assert.equal(calls.create[0].name, 'John');
  assert.deepEqual(calls.synced, [{ id: 5, b24Id: 100 }]);
  assert.equal(calls.failed.length, 0);
});

test('links to an existing Bitrix24 contact instead of creating a duplicate', async () => {
  const { job, calls } = createFakes({ contacts: [makeContact()] });
  job.bitrix24.searchContactByPhone = async (phone) => {
    calls.search.push(phone);
    return { ID: '77' };
  };

  const result = await job.run();
  assert.equal(result.results[0].bitrix24ContactId, 77);
  assert.equal(calls.create.length, 0, 'no duplicate created');
  assert.deepEqual(calls.synced, [{ id: 5, b24Id: 77 }]);
});

test('a failed resync keeps the contact FAILED with the error recorded', async () => {
  const { job, calls } = createFakes({ contacts: [makeContact()] });
  job.bitrix24.createContact = async () => {
    throw new Error('B24 quota exceeded');
  };

  const result = await job.run();
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].error, 'B24 quota exceeded');
  assert.equal(calls.failed.length, 1);
  assert.match(calls.failed[0].meta.error, /quota exceeded/);
  assert.equal(calls.synced.length, 0);
});

test('run is skipped when Bitrix24 is not configured', async () => {
  const { job } = createFakes({ contacts: [makeContact()] });
  const url = config.env.BITRIX24_WEBHOOK_URL;
  config.env.BITRIX24_WEBHOOK_URL = '';
  try {
    const result = await job.run();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'bitrix24-not-configured');
  } finally {
    config.env.BITRIX24_WEBHOOK_URL = url;
  }
});

test('empty backlog is a clean no-op', async () => {
  const { job } = createFakes({ contacts: [] });
  const result = await job.run();
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.results, []);
});
