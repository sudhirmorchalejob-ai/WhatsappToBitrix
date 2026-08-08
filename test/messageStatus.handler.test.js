const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageStatusHandler } = require('../src/webhooks/whatsbox/handlers/messageStatus.handler');

// ------------------------------------------------------------------ fakes

function createFakes({ existingMessage = null } = {}) {
  const calls = { lookup: [], record: [] };

  const messageRepo = {
    findByWhatsboxMessageId: async (id) => {
      calls.lookup.push(['byId', id]);
      return existingMessage && existingMessage.whatsboxMessageId === id ? existingMessage : null;
    },
    findByWamid: async (id) => {
      calls.lookup.push(['byWamid', id]);
      return existingMessage && existingMessage.wamid === id ? existingMessage : null;
    },
  };

  const service = {
    recordMessageStatus: async (input) => {
      calls.record.push(input);
      return { id: input.messageId, status: input.status };
    },
  };

  const handler = new MessageStatusHandler({ conversationService: service, messageRepo });
  return { handler, calls };
}

function statusCanonical(overrides = {}) {
  return {
    event: 'status',
    provider: 'WHATSBOX',
    messageId: 'provider-1',
    status: 'DELIVERED',
    failedReason: null,
    timestamp: new Date('2026-01-01T10:00:00Z'),
    channelId: '15551234567',
    raw: { status: 'delivered' },
    ...overrides,
  };
}

// --------------------------------------------------------------- tests

test('delivered status updates the matching outgoing message', async () => {
  const message = { id: 20, whatsboxMessageId: 'provider-1', direction: 'OUTGOING', status: 'SENT', retryCount: 0 };
  const { handler, calls } = createFakes({ existingMessage: message });

  const result = await handler.handle(statusCanonical());
  assert.equal(result.handled, true);
  assert.equal(result.status, 'DELIVERED');
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].messageId, 20);
  assert.equal(calls.record[0].status, 'DELIVERED');
});

test('read status is recorded', async () => {
  const message = { id: 20, whatsboxMessageId: 'provider-1', direction: 'OUTGOING', status: 'DELIVERED', retryCount: 0 };
  const { handler } = createFakes({ existingMessage: message });
  const result = await handler.handle(statusCanonical({ status: 'READ' }));
  assert.equal(result.handled, true);
  assert.equal(result.status, 'READ');
});

test('failed status on an outgoing message passes the failure reason', async () => {
  const message = { id: 20, whatsboxMessageId: 'provider-1', direction: 'OUTGOING', status: 'SENT', retryCount: 0 };
  const { handler, calls } = createFakes({ existingMessage: message });

  await handler.handle(statusCanonical({ status: 'FAILED', failedReason: 'rejected by provider' }));
  const record = calls.record[0];
  assert.equal(record.status, 'FAILED');
  assert.equal(record.error, 'rejected by provider');
});

test('lookup falls back to wamid when whatsboxMessageId does not match', async () => {
  const message = { id: 21, wamid: 'wamid-9', direction: 'OUTGOING', status: 'SENT', retryCount: 0 };
  const { handler, calls } = createFakes({ existingMessage: message });

  const result = await handler.handle(statusCanonical({ messageId: 'wamid-9', status: 'DELIVERED' }));
  assert.equal(result.handled, true);
  assert.deepEqual(calls.lookup[0], ['byId', 'wamid-9']);
  assert.deepEqual(calls.lookup[1], ['byWamid', 'wamid-9']);
});

test('status for an unknown message is skipped', async () => {
  const { handler } = createFakes({ existingMessage: null });
  const result = await handler.handle(statusCanonical({ messageId: 'ghost' }));
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'message-not-found');
});

test('status without a provider message id is skipped', async () => {
  const { handler } = createFakes();
  const result = await handler.handle(statusCanonical({ messageId: null }));
  assert.equal(result.reason, 'no-provider-message-id');
});

test('status event without a status value is skipped', async () => {
  const { handler } = createFakes();
  const result = await handler.handle(statusCanonical({ status: null }));
  assert.equal(result.reason, 'no-status');
});

test('non-status events are skipped', async () => {
  const { handler } = createFakes();
  const result = await handler.handle({ event: 'message', type: 'TEXT' });
  assert.equal(result.reason, 'not-a-status-event');
});
