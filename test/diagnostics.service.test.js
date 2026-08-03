const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { DiagnosticsService } = require('../src/services/diagnostics.service');

// ------------------------------------------------------------------ fakes

function createFakes(overrides = {}) {
  const defaultMessageRepo = {
    countByStatus: async () => ({ SENT: 10, FAILED: 1 }),
    countByDirection: async () => ({ INCOMING: 4, OUTGOING: 6 }),
    countPendingOutgoing: async () => 2,
  };

  const repos = {
    prisma: overrides.prisma || { $queryRawUnsafe: async () => [{ '1': 1 }] },
    contactRepo: overrides.contactRepo || {
      countBySyncStatus: async () => ({ SYNCED: 5, PENDING: 2 }),
    },
    conversationRepo: overrides.conversationRepo || {
      countByStatus: async () => ({ OPEN: 3, CLOSED: 1 }),
      countOpen: async () => 3,
    },
    messageRepo: overrides.messageRepo
      ? { ...defaultMessageRepo, ...overrides.messageRepo }
      : defaultMessageRepo,
    agentRepo: overrides.agentRepo || { count: async () => 3 },
    webhookLogRepo: overrides.webhookLogRepo || {
      countBySource: async () => ({ RECEIVED: 3, PROCESSED: 2, FAILED: 1 }),
    },
    retryJob: overrides.retryJob || { run: async (opts) => ({ scanned: 1, opts }) },
  };

  const service = new DiagnosticsService(repos);
  return { service, ...repos };
}

// ------------------------------------------------------------------ overview

test('overview aggregates counts and reports DB health', async () => {
  const { service } = createFakes();

  const result = await service.overview();

  assert.equal(result.db.ok, true);
  assert.equal(typeof result.db.latencyMs, 'number');

  assert.deepEqual(result.counts.contacts, { total: 7, bySyncStatus: { SYNCED: 5, PENDING: 2 } });
  assert.deepEqual(result.counts.conversations, {
    total: 4,
    open: 3,
    byStatus: { OPEN: 3, CLOSED: 1 },
  });
  assert.deepEqual(result.counts.messages, {
    total: 11,
    byStatus: { SENT: 10, FAILED: 1 },
    byDirection: { INCOMING: 4, OUTGOING: 6 },
    pendingOutgoing: 2,
  });
  assert.deepEqual(result.counts.agents, { total: 3 });
  assert.deepEqual(result.counts.webhooks, { RECEIVED: 3, PROCESSED: 2, FAILED: 1 });
  assert.equal(typeof result.timestamp, 'string');
});

test('overview reports provider configuration status from env', async () => {
  const url = config.env.WHATSBOX_API_URL;
  const key = config.env.WHATSBOX_API_KEY;
  const b24 = config.env.BITRIX24_WEBHOOK_URL;
  config.env.WHATSBOX_API_URL = 'https://api.whatsbox.io';
  config.env.WHATSBOX_API_KEY = 'test-key';
  config.env.BITRIX24_WEBHOOK_URL = 'https://b24.example.com/rest/1/abc/';

  try {
    const { service } = createFakes();
    const result = await service.overview();
    assert.equal(result.providers.whatsbox.configured, true);
    assert.equal(result.providers.bitrix24.configured, true);
    assert.equal(result.retry.enabled, config.env.RETRY_ENABLED);
  } finally {
    config.env.WHATSBOX_API_URL = url;
    config.env.WHATSBOX_API_KEY = key;
    config.env.BITRIX24_WEBHOOK_URL = b24;
  }
});

test('overview marks providers unconfigured when env values are empty', async () => {
  const url = config.env.WHATSBOX_API_URL;
  const key = config.env.WHATSBOX_API_KEY;
  const b24 = config.env.BITRIX24_WEBHOOK_URL;
  config.env.WHATSBOX_API_URL = '';
  config.env.WHATSBOX_API_KEY = '';
  config.env.BITRIX24_WEBHOOK_URL = '';

  try {
    const { service } = createFakes();
    const result = await service.overview();
    assert.equal(result.providers.whatsbox.configured, false);
    assert.equal(result.providers.bitrix24.configured, false);
  } finally {
    config.env.WHATSBOX_API_URL = url;
    config.env.WHATSBOX_API_KEY = key;
    config.env.BITRIX24_WEBHOOK_URL = b24;
  }
});

test('a failing section is reported as an error marker, not a crash', async () => {
  const { service } = createFakes({
    messageRepo: {
      countByStatus: async () => {
        throw new Error('db timeout');
      },
    },
  });

  const result = await service.overview();
  assert.equal(result.db.ok, true);
  assert.equal(result.counts.messages.error, 'db timeout');
  assert.deepEqual(result.counts.contacts, { total: 7, bySyncStatus: { SYNCED: 5, PENDING: 2 } });
});

test('DB ping failure is surfaced without breaking the rest', async () => {
  const { service } = createFakes({
    prisma: {
      $queryRawUnsafe: async () => {
        throw new Error('connection refused');
      },
    },
  });

  const result = await service.overview();
  assert.equal(result.db.ok, false);
  assert.match(result.db.error, /connection refused/);
});

// ------------------------------------------------------------ runRetryNow

test('runRetryNow forwards the admin overrides to the retry job', async () => {
  const { service, retryJob } = createFakes();

  const result = await service.runRetryNow({ limit: 10, maxRetries: 5, olderThanMinutes: 1 });

  assert.equal(result.scanned, 1);
  assert.deepEqual(result.opts, { limit: 10, maxRetries: 5, olderThanMinutes: 1 });
});
