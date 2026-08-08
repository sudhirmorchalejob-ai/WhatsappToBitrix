const { test } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const { ConversationService } = require('../src/services/conversation.service');

// ------------------------------------------------------------------ fakes

/**
 * In-memory repository + Bitrix24 stand-ins with call tracking.
 * Keeps the orchestration logic fully testable without a database.
 */
function createFakes(seed = {}) {
  const contacts = new Map();
  const conversations = new Map();
  const messages = new Map();
  const calls = {
    touchLastActivity: [],
    touchLastMessage: [],
    markSynced: [],
    markSyncFailed: [],
    updateStatus: [],
    statusCreate: [],
    dealSearch: [],
    dealCreate: [],
  };

  if (seed.contact) contacts.set(seed.contact.whatsappPhone, seed.contact);
  if (seed.conversation) conversations.set(seed.conversation.id, seed.conversation);
  if (seed.message) messages.set(seed.message.id, seed.message);

  const contactRepo = {
    findByWhatsappPhone: async (phone) => contacts.get(phone) || null,
    findById: async (id) => [...contacts.values()].find((c) => c.id === id) || null,
    create: async (data) => {
      const row = { id: contacts.size + 1, ...data, createdAt: new Date(), updatedAt: new Date() };
      contacts.set(row.whatsappPhone, row);
      return row;
    },
    update: async (id, data) => Object.assign([...contacts.values()].find((c) => c.id === id), data),
    touchLastActivity: async (id, at) => {
      calls.touchLastActivity.push(id);
      return [...contacts.values()].find((c) => c.id === id) && { id };
    },
    markSynced: async (id, b24Id) => {
      calls.markSynced.push({ id, b24Id });
      return contactRepo.update(id, { bitrix24ContactId: b24Id, syncStatus: 'SYNCED' });
    },
    markSyncFailed: async (id, meta) => {
      calls.markSyncFailed.push({ id, meta });
      return contactRepo.update(id, { syncStatus: 'FAILED', meta });
    },
  };

  const conversationRepo = {
    findByContactAndChannel: async (contactId, channel) =>
      [...conversations.values()].find((c) => c.contactId === contactId && c.channelNumber === channel) || null,
    create: async (data) => {
      const row = { id: conversations.size + 1, ...data, createdAt: new Date(), updatedAt: new Date() };
      conversations.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const row = conversations.get(id);
      return row ? Object.assign(row, data) : data;
    },
    touchLastMessage: async (id, opts) => {
      calls.touchLastMessage.push({ id, ...opts });
      return conversations.get(id);
    },
  };

  const messageRepo = {
    findById: async (id) => messages.get(id) || null,
    create: async (data) => {
      const row = { id: messages.size + 1, ...data, createdAt: new Date(), updatedAt: new Date() };
      messages.set(row.id, row);
      return row;
    },
    update: async (id, data) => Object.assign(messages.get(id), data),
    updateStatus: async (id, status, opts) => {
      calls.updateStatus.push({ id, status, opts });
      return messageRepo.update(id, { status, ...(opts ? opts : {}) });
    },
  };

  const messageStatusRepo = {
    create: async (data) => {
      calls.statusCreate.push(data);
      return { id: calls.statusCreate.length, ...data };
    },
  };

  const agentRepo = {
    findById: async (id) => (id === 7 ? { id: 7, bitrix24UserId: 701 } : null),
    upsertFromBitrix24: async (user) => ({ id: 1, bitrix24UserId: user.ID || user.id, name: user.NAME || user.name }),
  };

  const bitrix24 = {
    searchContactByPhone: async () => null,
    createContact: async () => 88,
    getDeal: async () => null,
    searchDealByContact: async () => null,
    createDeal: async (input) => {
      calls.dealCreate.push(input);
      return 12;
    },
  };

  const service = new ConversationService({
    contactRepo,
    conversationRepo,
    messageRepo,
    messageStatusRepo,
    assignmentRepo: {},
    agentRepo,
    bitrix24,
  });

  return { service, calls, contacts, conversations, messages, bitrix24 };
}

// ------------------------------------------------------------------ helpers

const CONTACT_INPUT = { phone: '15551234567', name: 'John', firstName: 'John', lastName: 'Doe' };

function seededContact() {
  return {
    id: 1,
    whatsappPhone: '15551234567',
    name: 'John',
    firstName: 'John',
    lastName: 'Doe',
    bitrix24ContactId: 55,
    syncStatus: 'SYNCED',
  };
}

function seededConversation() {
  return { id: 10, contactId: 1, channelNumber: '15551234567', dealId: null, status: 'OPEN' };
}

// ------------------------------------------------------------- ensureContact

test('ensureContact reuses an existing local contact and touches last activity', async () => {
  const { service, calls } = createFakes({ contact: seededContact() });
  const result = await service.ensureContact(CONTACT_INPUT);

  assert.equal(result.created, false);
  assert.equal(result.contact.id, 1);
  assert.ok(calls.touchLastActivity.includes(1));
});

test('ensureContact mirrors a contact found in Bitrix24', async () => {
  const { service, bitrix24 } = createFakes();
  bitrix24.searchContactByPhone = async () => ({ ID: '77', NAME: 'Maria', LAST_NAME: 'Lopez' });

  const result = await service.ensureContact(CONTACT_INPUT);
  assert.equal(result.created, true);
  assert.equal(result.fromBitrix24, true);
  assert.equal(result.contact.bitrix24ContactId, 77);
  assert.equal(result.contact.syncStatus, 'SYNCED');
  assert.equal(result.contact.name, 'Maria');
});

test('ensureContact creates locally then syncs to Bitrix24', async () => {
  const { service, calls, contacts } = createFakes();
  const result = await service.ensureContact(CONTACT_INPUT);

  assert.equal(result.created, true);
  assert.equal(result.fromBitrix24, false);
  assert.equal(result.contact.syncStatus, 'SYNCED');
  assert.equal(result.contact.bitrix24ContactId, 88);
  assert.deepEqual(calls.markSynced, [{ id: 1, b24Id: 88 }]);
  assert.equal(contacts.get('15551234567').id, 1);
});

test('ensureContact keeps the message local when Bitrix24 create fails', async () => {
  const { service, calls } = createFakes();
  service.bitrix24.createContact = async () => {
    throw new Error('B24 down');
  };

  const result = await service.ensureContact(CONTACT_INPUT);
  assert.equal(result.created, true);
  assert.equal(result.contact.syncStatus, 'FAILED');
  assert.equal(calls.markSyncFailed.length, 1);
  assert.match(calls.markSyncFailed[0].meta.error, /B24 down/);
});

test('ensureContact normalizes the phone and rejects empty input', async () => {
  const { service } = createFakes();
  const ok = await service.ensureContact({ phone: ' (555) 123-4567 ', name: 'X' });
  assert.equal(ok.contact.whatsappPhone, '5551234567');
  await assert.rejects(() => service.ensureContact({ phone: '' }), AppError);
});

// --------------------------------------------------------- ensureConversation

test('ensureConversation creates a new conversation for a channel', async () => {
  const { service } = createFakes();
  const result = await service.ensureConversation({ contactId: 1, channelNumber: '15551234567' });
  assert.equal(result.created, true);
  assert.equal(result.conversation.channelNumber, '15551234567');
  assert.equal(result.conversation.status, 'OPEN');
});

test('ensureConversation reuses an existing conversation', async () => {
  const { service } = createFakes({ conversation: seededConversation() });
  const result = await service.ensureConversation({ contactId: 1, channelNumber: '15551234567' });
  assert.equal(result.created, false);
  assert.equal(result.conversation.id, 10);
});

test('ensureConversation persists the channel provider and Meta phone number id', async () => {
  const { service, conversations } = createFakes();
  const result = await service.ensureConversation({
    contactId: 1,
    channelNumber: '15551234567',
    provider: 'META',
    phoneNumberId: '1077',
  });
  assert.equal(result.created, true);
  assert.equal(result.conversation.provider, 'META');
  assert.equal(result.conversation.phoneNumberId, '1077');
  assert.equal(conversations.get(result.conversation.id).provider, 'META');
});

test('ensureConversation defaults the provider to WHATSBOX', async () => {
  const { service } = createFakes();
  const result = await service.ensureConversation({ contactId: 1, channelNumber: '15551234567' });
  assert.equal(result.conversation.provider, 'WHATSBOX');
});

test('ensureConversation updates the provider when the channel provider changes', async () => {
  const { service, conversations } = createFakes({
    conversation: { ...seededConversation(), provider: 'WHATSBOX', phoneNumberId: null },
  });
  const result = await service.ensureConversation({
    contactId: 1,
    channelNumber: '15551234567',
    provider: 'META',
    phoneNumberId: '1077',
  });
  assert.equal(result.created, false);
  assert.equal(conversations.get(10).provider, 'META');
  assert.equal(conversations.get(10).phoneNumberId, '1077');
});

// ------------------------------------------------------------- ensureOpenDeal

test('ensureOpenDeal reuses a linked open deal without searching', async () => {
  const { service, calls } = createFakes();
  const conversation = { ...seededConversation(), dealId: 5 };
  service.bitrix24.getDeal = async () => ({ ID: 5, CLOSED: 'N' });

  const result = await service.ensureOpenDeal({ contact: seededContact(), conversation, firstMessageBody: 'hi' });
  assert.equal(result.created, false);
  assert.equal(result.deal.ID, 5);
  assert.equal(calls.dealSearch.length, 0);
});

test('ensureOpenDeal falls back to search when linked deal is closed', async () => {
  const conversation = { ...seededConversation(), dealId: 5 };
  const { service, calls } = createFakes({ conversation });
  service.bitrix24.getDeal = async () => ({ ID: 5, CLOSED: 'Y' });
  service.bitrix24.searchDealByContact = async () => {
    calls.dealSearch.push(true);
    return { ID: 9, CLOSED: 'N' };
  };

  const result = await service.ensureOpenDeal({ contact: seededContact(), conversation });
  assert.equal(result.deal.ID, 9);
  assert.equal(conversation.dealId, 9);
  assert.equal(calls.dealSearch.length, 1);
});

test('ensureOpenDeal skips when the contact is not synced to Bitrix24', async () => {
  const { service } = createFakes();
  const contact = { ...seededContact(), bitrix24ContactId: null };
  const result = await service.ensureOpenDeal({ contact, conversation: seededConversation() });
  assert.equal(result.skipped, 'contact-not-synced');
  assert.equal(result.deal, null);
});

test('ensureOpenDeal creates a deal when no open deal exists', async () => {
  const conversation = seededConversation();
  const { service, calls } = createFakes({ conversation });
  service.bitrix24.searchDealByContact = async () => null;

  const result = await service.ensureOpenDeal({ contact: seededContact(), conversation, firstMessageBody: 'hello' });
  assert.equal(result.created, true);
  assert.equal(result.deal.ID, '12');
  assert.equal(conversation.dealId, 12);
  assert.equal(calls.dealCreate.length, 1);
  assert.equal(calls.dealCreate[0].contactId, 55);
  assert.match(calls.dealCreate[0].title, /John Doe/);
});

test('ensureOpenDeal handles deal creation failure non-fatally', async () => {
  const conversation = seededConversation();
  const { service, calls } = createFakes({ conversation });
  service.bitrix24.createDeal = async () => {
    calls.dealCreate.push({ failed: true });
    throw new Error('stage missing');
  };

  const result = await service.ensureOpenDeal({ contact: seededContact(), conversation });
  assert.equal(result.skipped, 'deal-create-failed');
  assert.equal(result.deal, null);
  assert.equal(calls.dealCreate.length, 1);
});

test('ensureOpenDeal passes the assigned agent to the new deal', async () => {
  const { service, calls } = createFakes();
  const conversation = { ...seededConversation(), assignedAgentId: 7 };
  service.bitrix24.searchDealByContact = async () => null;

  await service.ensureOpenDeal({ contact: seededContact(), conversation });
  assert.equal(calls.dealCreate[0].assignedById, 701);
});

// -------------------------------------------------------------- saveMessage

test('saveMessage persists an incoming message and increments unread', async () => {
  const { service, calls, messages } = createFakes();
  const contact = seededContact();
  const conversation = { ...seededConversation(), dealId: 12 };

  const saved = await service.saveMessage({
    conversation,
    contact,
    direction: 'INCOMING',
    type: 'TEXT',
    body: 'Hello there',
    timestamp: new Date('2026-01-01T10:00:00Z'),
  });

  assert.equal(saved.conversationId, 10);
  assert.equal(saved.contactId, 1);
  assert.equal(saved.dealId, 12);
  assert.equal(messages.size, 1);

  const touch = calls.touchLastMessage[0];
  assert.equal(touch.id, 10);
  assert.equal(touch.incrementUnread, true);
  assert.equal(touch.preview, 'Hello there');
  assert.ok(calls.touchLastActivity.includes(1));
});

test('saveMessage does not increment unread for outgoing messages', async () => {
  const { service, calls } = createFakes();
  await service.saveMessage({
    conversation: seededConversation(),
    contact: seededContact(),
    direction: 'OUTGOING',
    type: 'TEXT',
    body: 'Out',
  });
  assert.equal(calls.touchLastMessage[0].incrementUnread, false);
});

// --------------------------------------------------------- recordMessageStatus

test('recordMessageStatus forwards state and appends an audit row', async () => {
  const { service, calls, messages } = createFakes({
    message: { id: 20, status: 'SENT', retryCount: 0 },
  });

  const result = await service.recordMessageStatus({ messageId: 20, status: 'DELIVERED' });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(calls.updateStatus.length, 1);
  assert.equal(calls.statusCreate.length, 1);
  assert.equal(messages.get(20).status, 'DELIVERED');
});

test('recordMessageStatus accepts FAILED while pending/sent', async () => {
  const { service, calls } = createFakes({ message: { id: 20, status: 'SENT', retryCount: 1 } });
  const result = await service.recordMessageStatus({ messageId: 20, status: 'FAILED', error: 'undelivered' });
  assert.equal(result.status, 'FAILED');
  assert.equal(calls.updateStatus.length, 1);
});

test('recordMessageStatus ignores FAILED after delivery/read (terminal)', async () => {
  const { service, calls } = createFakes({ message: { id: 20, status: 'READ', retryCount: 0 } });
  const result = await service.recordMessageStatus({ messageId: 20, status: 'FAILED', error: 'late failure' });
  assert.equal(result.status, 'READ', 'state must not regress');
  assert.equal(calls.updateStatus.length, 0);
  assert.equal(calls.statusCreate.length, 1, 'audit row still recorded');
});

test('recordMessageStatus ignores a backward transition but keeps the audit row', async () => {
  const { service, calls } = createFakes({ message: { id: 20, status: 'READ', retryCount: 0 } });
  await service.recordMessageStatus({ messageId: 20, status: 'DELIVERED' });
  assert.equal(calls.updateStatus.length, 0, 'no backward status update');
  assert.equal(calls.statusCreate.length, 1, 'audit row still recorded');
});

test('recordMessageStatus throws AppError for unknown message', async () => {
  const { service } = createFakes();
  await assert.rejects(() => service.recordMessageStatus({ messageId: 999, status: 'SENT' }), AppError);
});

// ------------------------------------------------------------- helpers

test('updateOutgoingMessageId backfills provider ids', async () => {
  const { service, messages } = createFakes({ message: { id: 30, status: 'PENDING' } });
  await service.updateOutgoingMessageId({ id: 30, whatsboxMessageId: 'wamid-1', wamid: 'wamid-2' });
  assert.equal(messages.get(30).whatsboxMessageId, 'wamid-1');
  assert.equal(messages.get(30).wamid, 'wamid-2');
});

test('syncAgent mirrors a Bitrix24 user into the agents cache', async () => {
  const { service } = createFakes();
  const agent = await service.syncAgent({ ID: 701, NAME: 'Agent Smith' });
  assert.equal(agent.bitrix24UserId, 701);
});
