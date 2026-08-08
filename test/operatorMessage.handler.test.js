const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OperatorMessageHandler } = require('../src/webhooks/bitrix24/handlers/operatorMessage.handler');
const { BITRIX24_METHODS } = require('../src/constants');

function makeCanonical(overrides = {}) {
  return {
    event: 'operatorMessage',
    provider: 'BITRIX24',
    eventName: 'ONIMCONNECTORMESSAGEADD',
    memberId: 'm1',
    connector: 'myconnector',
    line: 107,
    b24ChatId: 1807,
    b24MessageId: 86497,
    userId: 27,
    text: 'Hello from operator',
    externalChatId: 'channel-123',
    timestamp: new Date(1773759161 * 1000),
    ...overrides,
  };
}

function makeInstall(overrides = {}) {
  return {
    memberId: 'm1',
    domain: 'portal.bitrix24.com',
    clientEndpoint: 'https://portal.bitrix24.com/rest/',
    accessToken: 'old-token',
    applicationToken: 'apptok',
    scope: 'imconnector',
    ...overrides,
  };
}

function makeAuth(overrides = {}) {
  return {
    member_id: 'm1',
    access_token: 'fresh-token',
    expires_in: 3600,
    domain: 'portal.bitrix24.com',
    ...overrides,
  };
}

function makeFakes(overrides = {}) {
  const calls = {
    dedup: [],
    rotate: [],
    updates: [],
    assignments: [],
    deliveries: [],
    activates: [],
    saved: [],
    getUsers: 0,
    whatsboxSends: [],
    whatsboxMediaSends: [],
    metaSends: [],
    metaMediaSends: [],
    idBackfill: [],
    statuses: [],
    statusUpdates: [],
  };

  const conversation = overrides.conversation || {
    id: 3,
    dealId: 10,
    assignedAgentId: null,
    provider: overrides.provider || 'WHATSBOX',
    phoneNumberId: overrides.phoneNumberId || null,
    channelNumber: overrides.channelNumber || '15550000000',
    contact: overrides.contact || { id: 9, whatsappPhone: '+15550001111' },
  };

  const messageRepo = {
    findByOperatorReplyId: async (id) => {
      calls.dedup.push(id);
      return overrides.duplicate ? { id: 99 } : null;
    },
    updateStatus: async (id, status, opts) => {
      calls.statusUpdates.push({ id, status, opts });
      return { id, status };
    },
  };

  const conversationRepo = {
    findByExternalChatId: async (id) => {
      if (overrides.conversations !== undefined) return overrides.conversations;
      return id === 'channel-123' ? conversation : null;
    },
    update: async (id, data) => {
      calls.updates.push({ id, data });
      return { ...conversation, ...data };
    },
  };

  const agentRepo = {
    findByBitrix24Id: async (userId) =>
      overrides.knownAgent && Number(userId) === overrides.knownAgent.bitrix24UserId ? overrides.knownAgent : null,
    upsertFromBitrix24: async (user) => {
      calls.savedAgent = user;
      return overrides.knownAgent || { id: 7, bitrix24UserId: Number(user.ID) };
    },
  };

  const assignmentRepo = {
    assign: async (data) => {
      calls.assignments.push(data);
    },
  };

  const bitrix24 = {
    installRepo: {
      updateTokens: async (memberId, data) => {
        calls.rotate.push({ memberId, data });
      },
    },
    activate(memberId) {
      calls.activates.push(memberId);
    },
    async getUsers() {
      calls.getUsers += 1;
      if (overrides.getUsersError) throw overrides.getUsersError;
      return [{ ID: 27, NAME: 'Klaus' }];
    },
    async call(method, params) {
      calls.deliveries.push({ method, params });
      if (overrides.deliveryFail) {
        const err = new Error('b24 down');
        err.code = 'NETWORK_ERROR';
        throw err;
      }
      return { result: { SUCCESS: true } };
    },
  };

  const conversationService = {
    async saveMessage(input) {
      calls.saved.push(input);
      return { id: 5 };
    },
    async updateOutgoingMessageId({ id, whatsboxMessageId, wamid }) {
      calls.idBackfill.push({ id, whatsboxMessageId, wamid });
      return { id };
    },
    async recordMessageStatus({ messageId, status, error, providerStatus }) {
      calls.statuses.push({ messageId, status, error, providerStatus });
      return { id: messageId, status };
    },
  };

  const whatsbox = {
    sendText: async (input) => {
      calls.whatsboxSends.push(input);
      if (overrides.sendFail) {
        const err = new Error(overrides.sendError || 'provider rejected');
        err.code = 'PROVIDER_ERROR';
        throw err;
      }
      return overrides.whatsboxResult || { whatsboxMessageId: 'wb-send-1', raw: { ok: true } };
    },
    sendMedia: async (input) => {
      calls.whatsboxMediaSends.push(input);
      if (overrides.sendFail) {
        const err = new Error(overrides.sendError || 'provider rejected');
        err.code = 'PROVIDER_ERROR';
        throw err;
      }
      return overrides.whatsboxResult || { whatsboxMessageId: 'wb-media-1', raw: { ok: true } };
    },
  };

  const meta = {
    sendText: async (input) => {
      calls.metaSends.push(input);
      if (overrides.sendFail) {
        const err = new Error(overrides.sendError || 'provider rejected');
        err.code = 'META_ERROR';
        throw err;
      }
      return overrides.metaResult || { wamid: 'wamid.1', raw: { ok: true } };
    },
    sendMedia: async (input) => {
      calls.metaMediaSends.push(input);
      if (overrides.sendFail) {
        const err = new Error(overrides.sendError || 'provider rejected');
        err.code = 'META_ERROR';
        throw err;
      }
      return overrides.metaResult || { wamid: 'wamid.2', raw: { ok: true } };
    },
  };

  const handler = new OperatorMessageHandler({
    conversationService,
    messageRepo,
    conversationRepo,
    agentRepo,
    assignmentRepo,
    bitrix24,
    whatsbox,
    meta,
  });

  return { handler, calls };
}

test('happy path sends the reply via WhatsBox and advances it to SENT', async () => {
  const { handler, calls } = makeFakes();
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });

  assert.equal(result.handled, true);
  assert.equal(result.messageId, 5);
  assert.equal(result.agentId, 7);
  assert.equal(result.providerId, 'b24:m1:86497');
  assert.equal(result.provider, 'WHATSBOX');
  assert.equal(result.sent, true);

  // Dedup looks up the payload-based operator reply id.
  assert.deepEqual(calls.dedup, ['b24:m1:86497']);
  assert.deepEqual(calls.activates, ['m1']);

  // Token rotation from the event auth.
  assert.equal(calls.rotate.length, 1);
  assert.equal(calls.rotate[0].data.accessToken, 'fresh-token');

  // Agent enrichment via user.get.
  assert.equal(calls.getUsers, 1);
  assert.deepEqual(calls.savedAgent, { ID: 27, NAME: 'Klaus' });

  // Conversation reassignment.
  assert.deepEqual(calls.updates, [{ id: 3, data: { assignedAgentId: 7 } }]);
  assert.deepEqual(calls.assignments, [{ conversationId: 3, agentId: 7 }]);

  // OUTGOING message persisted as PENDING with the dedup id in payload.
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].direction, 'OUTGOING');
  assert.equal(calls.saved[0].type, 'TEXT');
  assert.equal(calls.saved[0].body, 'Hello from operator');
  assert.equal(calls.saved[0].status, 'PENDING');
  assert.deepEqual(calls.saved[0].payload, { operatorReplyId: 'b24:m1:86497' });

  // The reply is actually sent to WhatsApp over WhatsBox.
  assert.equal(calls.whatsboxSends.length, 1);
  assert.equal(calls.whatsboxSends[0].to, '+15550001111');
  assert.equal(calls.whatsboxSends[0].body, 'Hello from operator');
  assert.equal(calls.whatsboxSends[0].channelId, '15550000000');

  // Provider id backfilled + state advanced to SENT.
  assert.deepEqual(calls.idBackfill, [{ id: 5, whatsboxMessageId: 'wb-send-1', wamid: null }]);
  assert.equal(calls.statuses.length, 1);
  assert.equal(calls.statuses[0].status, 'SENT');
  assert.equal(calls.statuses[0].providerStatus, 'WHATSBOX');
  assert.equal(calls.statusUpdates.length, 1);
  assert.equal(calls.statusUpdates[0].id, 5);
  assert.equal(calls.statusUpdates[0].status, 'SENT');
  assert.ok(calls.statusUpdates[0].opts.sentAt instanceof Date);

  // Delivery confirmation references the local message id.
  assert.equal(calls.deliveries.length, 1);
  assert.equal(calls.deliveries[0].method, BITRIX24_METHODS.IMCONNECTOR_SEND_STATUS_DELIVERY);
  assert.deepEqual(calls.deliveries[0].params.MESSAGES[0].im, { chat_id: 1807, message_id: 86497 });
  assert.deepEqual(calls.deliveries[0].params.MESSAGES[0].message.id, [5]);
  assert.equal(calls.deliveries[0].params.MESSAGES[0].chat.id, 'channel-123');
});

test('replies on a Meta conversation are sent over the Meta provider with the stored phone number id', async () => {
  const { handler, calls } = makeFakes({ provider: 'META', phoneNumberId: '1077', channelNumber: '15550000000' });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });

  assert.equal(result.handled, true);
  assert.equal(result.provider, 'META');
  assert.equal(result.sent, true);

  assert.equal(calls.metaSends.length, 1);
  assert.equal(calls.metaSends[0].to, '+15550001111');
  assert.equal(calls.metaSends[0].body, 'Hello from operator');
  assert.equal(calls.metaSends[0].phoneNumberId, '1077');
  assert.equal(calls.whatsboxSends.length, 0);

  assert.deepEqual(calls.idBackfill, [{ id: 5, whatsboxMessageId: null, wamid: 'wamid.1' }]);
  assert.equal(calls.statuses[0].status, 'SENT');
});

test('a provider send failure marks the message FAILED and still confirms delivery', async () => {
  const { handler, calls } = makeFakes({ sendFail: true });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });

  assert.equal(result.handled, true);
  assert.equal(result.sent, false);
  assert.equal(result.provider, 'WHATSBOX');

  assert.equal(calls.whatsboxSends.length, 1);
  assert.equal(calls.idBackfill.length, 0, 'no provider id backfilled on failure');
  assert.equal(calls.statuses.length, 1);
  assert.equal(calls.statuses[0].status, 'FAILED');
  assert.equal(calls.statuses[0].error, 'provider rejected');
  assert.equal(calls.statusUpdates.length, 0, 'state stays FAILED, no SENT update');

  assert.equal(calls.deliveries.length, 1, 'delivery confirmation still sent');
});

test('a reply without a customer phone is recorded but not sent', async () => {
  const { handler, calls } = makeFakes({ contact: { id: 9, whatsappPhone: null } });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });

  assert.equal(result.handled, true);
  assert.equal(result.sent, false);
  assert.equal(result.provider, 'NONE');

  assert.equal(calls.whatsboxSends.length, 0);
  assert.equal(calls.metaSends.length, 0);
  assert.equal(calls.saved.length, 1, 'message still persisted');
  assert.equal(calls.statuses[0].status, 'FAILED');
  assert.equal(calls.statuses[0].error, 'contact-has-no-whatsapp-number');
  assert.equal(calls.deliveries.length, 1, 'delivery confirmation still sent');
});

test('duplicate events are skipped without side effects', async () => {
  const { handler, calls } = makeFakes({ duplicate: true });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'duplicate');
  assert.equal(calls.rotate.length, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.deliveries.length, 0);
  assert.equal(calls.activates.length, 0);
  assert.equal(calls.whatsboxSends.length, 0);
});

test('operator reply for an unknown chat is skipped', async () => {
  const { handler, calls } = makeFakes({ conversations: null });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'conversation-not-found');
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.deliveries.length, 0);
});

test('non-operator-message events are skipped', async () => {
  const { handler, calls } = makeFakes();
  const result = await handler.handle(makeCanonical({ event: 'operatorMessageUpdate' }), { install: makeInstall() });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'not-an-operator-message');
  assert.equal(calls.saved.length, 0);
});

test('missing external chat id is skipped', async () => {
  const { handler, calls } = makeFakes();
  const result = await handler.handle(makeCanonical({ externalChatId: null }), { install: makeInstall() });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-external-chat-id');
  assert.equal(calls.saved.length, 0);
});

test('missing user id is skipped before saving', async () => {
  const { handler, calls } = makeFakes();
  const result = await handler.handle(makeCanonical({ userId: null }), { install: makeInstall() });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-agent-user');
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.deliveries.length, 0);
});

test('a known agent skips the user.get enrichment round-trip', async () => {
  const { handler, calls } = makeFakes({ knownAgent: { id: 7, bitrix24UserId: 27, name: 'Klaus' } });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });
  assert.equal(result.handled, true);
  assert.equal(calls.getUsers, 0);
  assert.equal(calls.savedAgent, undefined);
});

test('delivery confirmation failure is non-fatal', async () => {
  const { handler, calls } = makeFakes({ deliveryFail: true });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });
  assert.equal(result.handled, true);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.whatsboxSends.length, 1);
  assert.equal(calls.deliveries.length, 1);
});

test('a failed agent enrichment falls back to a minimal agent row', async () => {
  const { handler, calls } = makeFakes({ getUsersError: new Error('boom') });
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: makeAuth() });
  assert.equal(result.handled, true);
  assert.equal(calls.getUsers, 1);
  assert.deepEqual(calls.savedAgent, { ID: 27, NAME: 'Agent 27' });
  assert.deepEqual(calls.updates, [{ id: 3, data: { assignedAgentId: 7 } }]);
});

test('no token rotation when the event auth carries no access_token', async () => {
  const { handler, calls } = makeFakes();
  const result = await handler.handle(makeCanonical(), { install: makeInstall(), auth: { member_id: 'm1' } });
  assert.equal(result.handled, true);
  assert.equal(calls.rotate.length, 0);
});
