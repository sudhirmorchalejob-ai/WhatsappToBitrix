const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RetryOutgoingMessagesJob, TYPE_TO_WHATSBOX } = require('../src/jobs/retryOutgoingMessages.job');

// Jobs gate on env config at run time; the repo's .env ships with the
// providers unset, so tests pin truthy values (restored by the
// "not configured" test).
const config = require('../src/config');
config.env.WHATSBOX_API_URL = config.env.WHATSBOX_API_URL || 'https://api.whatsbox.io';
config.env.WHATSBOX_API_KEY = config.env.WHATSBOX_API_KEY || 'test-key';

// ------------------------------------------------------------------ fakes

function makeMessage(overrides = {}) {
  return {
    id: 1,
    retryCount: 0,
    type: 'TEXT',
    body: 'Hello again',
    caption: null,
    mediaUrl: null,
    mediaName: null,
    status: 'PENDING',
    conversation: {
      provider: 'WHATSBOX',
      channelNumber: '15551234567',
      phoneNumberId: null,
      contact: { whatsappPhone: '15559998877' },
    },
    ...overrides,
  };
}

function createFakes({ pending = [] } = {}) {
  const calls = { sends: [], updates: [], statusRows: [], idBackfill: [] };

  const messageRepo = {
    findPendingOutgoing: async () => pending,
    update: async (id, data) => {
      calls.updates.push({ id, ...data });
    },
    updateStatus: async (id, status, opts) => {
      calls.updates.push({ id, status, ...(opts || {}) });
    },
  };

  const messageStatusRepo = {
    create: async (data) => {
      calls.statusRows.push(data);
      return { id: calls.statusRows.length, ...data };
    },
  };

  const conversationService = {
    updateOutgoingMessageId: async (input) => {
      calls.idBackfill.push(input);
      return {};
    },
  };

  const whatsbox = {
    sendText: async (input) => {
      calls.sends.push(['whatsbox-text', input]);
      return { whatsboxMessageId: 'new-provider-id', raw: { ok: true } };
    },
    sendMedia: async (input) => {
      calls.sends.push(['whatsbox-media', input]);
      return { whatsboxMessageId: 'new-provider-id', raw: { ok: true } };
    },
  };

  const meta = {
    sendText: async (input) => {
      calls.sends.push(['meta-text', input]);
      return { wamid: 'wamid.1', raw: { ok: true } };
    },
    sendMedia: async (input) => {
      calls.sends.push(['meta-media', input]);
      return { wamid: 'wamid.1', raw: { ok: true } };
    },
  };

  const job = new RetryOutgoingMessagesJob({
    messageRepo,
    messageStatusRepo,
    whatsbox,
    meta,
    conversationService,
    intervalMs: 60000,
    maxRetries: 3,
  });

  return { job, calls, messageRepo };
}

// --------------------------------------------------------------- tests

test('retries a pending text message and marks it SENT', async () => {
  const message = makeMessage();
  const { job, calls } = createFakes({ pending: [message] });

  const result = await job.run();
  assert.equal(result.scanned, 1);
  assert.equal(result.results[0].ok, true);

  assert.deepEqual(calls.sends[0][0], 'whatsbox-text');
  assert.equal(calls.sends[0][1].to, '15559998877');
  assert.equal(calls.sends[0][1].body, 'Hello again');

  assert.deepEqual(calls.idBackfill, [{ id: 1, whatsboxMessageId: 'new-provider-id' }]);
  assert.equal(calls.updates.some((u) => u.status === 'SENT'), true);
  assert.equal(calls.statusRows.length, 1);
  assert.equal(calls.statusRows[0].providerStatus, 'RETRY');
});

test('a failed retry increments retryCount and stays PENDING within budget', async () => {
  const message = makeMessage();
  const { job, calls } = createFakes({ pending: [message] });
  job.whatsbox.sendText = async () => {
    throw new Error('provider timeout');
  };

  const result = await job.run();
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].retryCount, 1);

  const update = calls.updates.find((u) => u.id === 1 && u.retryCount !== undefined);
  assert.equal(update.retryCount, 1);
  assert.equal(update.status, 'PENDING');
  assert.equal(update.error, 'provider timeout');
});

test('exhausting the retry budget marks the message FAILED permanently', async () => {
  const message = makeMessage({ retryCount: 2 });
  const { job, calls } = createFakes({ pending: [message] });
  job.whatsbox.sendText = async () => {
    throw new Error('still down');
  };

  await job.run();
  const update = calls.updates.find((u) => u.id === 1 && u.retryCount !== undefined);
  assert.equal(update.retryCount, 3);
  assert.equal(update.status, 'FAILED');
});

test('media messages are re-sent with the mapped WhatsBox type', async () => {
  const message = makeMessage({ type: 'PDF', body: null, mediaUrl: 'https://cdn/x.pdf', mediaName: 'inv.pdf' });
  const { job, calls } = createFakes({ pending: [message] });

  await job.run();
  assert.deepEqual(calls.sends[0][0], 'whatsbox-media');
  assert.equal(calls.sends[0][1].type, 'document');
  assert.equal(calls.sends[0][1].link, 'https://cdn/x.pdf');
});

test('unretriable message types are skipped without burning budget silently', async () => {
  const message = makeMessage({ type: 'CONTACT', body: null, mediaUrl: null });
  const { job, calls } = createFakes({ pending: [message] });

  await job.run();
  const update = calls.updates.find((u) => u.id === 1 && u.retryCount !== undefined);
  assert.equal(update.retryCount, 1);
  assert.equal(update.status, 'PENDING');
  assert.match(update.error, /cannot be retried/i);
});

test('a media message without mediaUrl cannot be retried', async () => {
  const message = makeMessage({ type: 'IMAGE', body: null, mediaUrl: null });
  const { job } = createFakes({ pending: [message] });
  job.whatsbox.sendMedia = async () => {
    throw new Error('should not be called');
  };

  const result = await job.run();
  assert.match(result.results[0].error, /no mediaUrl/i);
});

test('run is skipped when no provider is configured', async () => {
  const { job } = createFakes({ pending: [makeMessage()] });
  const url = config.env.WHATSBOX_API_URL;
  const key = config.env.WHATSBOX_API_KEY;
  const metaToken = config.env.META_ACCESS_TOKEN;
  const metaPhone = config.env.META_PHONE_NUMBER_ID;
  config.env.WHATSBOX_API_URL = '';
  config.env.WHATSBOX_API_KEY = '';
  config.env.META_ACCESS_TOKEN = '';
  config.env.META_PHONE_NUMBER_ID = '';
  try {
    const result = await job.run();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-provider-configured');
  } finally {
    config.env.WHATSBOX_API_URL = url;
    config.env.WHATSBOX_API_KEY = key;
    config.env.META_ACCESS_TOKEN = metaToken;
    config.env.META_PHONE_NUMBER_ID = metaPhone;
  }
});

test('a Meta conversation is retried over the Meta provider and backfills the wamid', async () => {
  const message = makeMessage({
    conversation: { provider: 'META', channelNumber: '15550000000', phoneNumberId: '1077', contact: { whatsappPhone: '15559998877' } },
  });
  const { job, calls } = createFakes({ pending: [message] });

  const result = await job.run();
  assert.equal(result.results[0].ok, true);

  assert.deepEqual(calls.sends[0][0], 'meta-text');
  assert.equal(calls.sends[0][1].to, '15559998877');
  assert.equal(calls.sends[0][1].phoneNumberId, '1077');
  assert.deepEqual(calls.idBackfill, [{ id: 1, wamid: 'wamid.1' }]);
});

test('concurrent runs are skipped', async () => {
  const message = makeMessage();
  const { job, calls } = createFakes({ pending: [message] });
  job.whatsbox.sendText = (input) =>
    new Promise((resolve) => {
      setTimeout(() => {
        calls.sends.push(['text', input]);
        resolve({ whatsboxMessageId: 'x' });
      }, 30);
    });

  const first = job.run();
  const second = await job.run();
  assert.equal(second.skipped, true);
  await first;
  assert.equal(calls.sends.length, 1);});

test('TYPE_TO_WHATSBOX maps DB types to provider media types', () => {
  assert.equal(TYPE_TO_WHATSBOX.PDF, 'document');
  assert.equal(TYPE_TO_WHATSBOX.DOCUMENT, 'document');
  assert.equal(TYPE_TO_WHATSBOX.VOICE, 'audio');
  assert.equal(TYPE_TO_WHATSBOX.IMAGE, 'image');
  assert.equal(TYPE_TO_WHATSBOX.VIDEO, 'video');
});
