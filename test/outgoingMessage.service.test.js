const { test } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const { OutgoingMessageService } = require('../src/services/outgoingMessage.service');

// ------------------------------------------------------------------ fakes

/**
 * In-memory stand-ins for the outgoing service's collaborators, with
 * call tracking. The ConversationService and WhatsBox service are faked
 * so these tests focus on the outgoing orchestration (resolution, type
 * mapping, send policy) rather than re-testing those layers.
 */
function createFakes(overrides = {}) {
  const messages = new Map();
  const calls = { sends: [], statusCreate: [], ensureContact: 0, ensureConversation: 0, ensureOpenDeal: 0 };

  const contact = {
    id: 1,
    whatsappPhone: '15551234567',
    name: 'John',
    firstName: 'John',
    lastName: 'Doe',
    bitrix24ContactId: 55,
    syncStatus: 'SYNCED',
  };
  const conversation = { id: 10, contactId: 1, channelNumber: '15551234567', status: 'OPEN', dealId: null };

  const conversationService = {
    ensureContact: async () => {
      calls.ensureContact += 1;
      return { contact };
    },
    ensureConversation: async ({ contactId, channelNumber }) => {
      calls.ensureConversation += 1;
      return { conversation: { ...conversation, contactId, channelNumber } };
    },
    ensureOpenDeal: async () => {
      calls.ensureOpenDeal += 1;
      return { deal: { ID: 12 }, created: true };
    },
    saveMessage: async (data) => {
      const row = {
        id: 100,
        ...data,
        conversationId: data.conversation && data.conversation.id,
        contactId: data.contact && data.contact.id,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      messages.set(row.id, row);
      return row;
    },
    updateOutgoingMessageId: async ({ id, whatsboxMessageId }) => {
      messages.get(id).whatsboxMessageId = whatsboxMessageId;
      return messages.get(id);
    },
    recordMessageStatus: async ({ messageId, status, error }) => {
      calls.statusCreate.push({ messageId, status, error });
      const row = messages.get(messageId);
      row.status = status;
      if (error) row.error = error;
      return row;
    },
  };

  const whatsbox = {
    sendText: async (input) => {
      calls.sends.push({ kind: 'text', ...input });
      return { whatsboxMessageId: 'wb-text-1' };
    },
    sendMedia: async (input) => {
      calls.sends.push({ kind: 'media', ...input });
      return { whatsboxMessageId: 'wb-media-1' };
    },
  };

  const messageRepo = {
    findById: async (id) => messages.get(id) || null,
    updateStatus: async (id, status, opts = {}) => {
      const row = messages.get(id);
      row.status = status;
      if (opts.sentAt) row.sentAt = opts.sentAt;
      return row;
    },
  };

  const conversationRepo = {
    findById: async (id) => (id === 10 ? { ...conversation, contact } : null),
  };

  const service = new OutgoingMessageService({
    conversationService,
    whatsbox,
    messageRepo,
    conversationRepo,
  });

  return { service, calls, messages, contact, conversation, conversationService, whatsbox };
}

const TEXT_INPUT = { to: '15551234567', body: 'Hello from the API' };

// ---------------------------------------------------------------- sendText

test('sendText resolves contact/conversation/deal and persists then sends', async () => {
  const { service, calls, messages } = createFakes();

  const result = await service.sendText(TEXT_INPUT);

  assert.equal(calls.ensureContact, 1);
  assert.equal(calls.ensureConversation, 1);
  assert.equal(calls.ensureOpenDeal, 1);

  const message = messages.get(100);
  assert.equal(message.direction, 'OUTGOING');
  assert.equal(message.type, 'TEXT');
  assert.equal(message.body, 'Hello from the API');
  assert.equal(message.dealId, 12);
  assert.equal(message.status, 'SENT', 'successful send advances the state');
  assert.ok(message.sentAt);
  assert.equal(message.whatsboxMessageId, 'wb-text-1');

  const send = calls.sends[0];
  assert.equal(send.kind, 'text');
  assert.equal(send.to, '15551234567');
  assert.equal(send.body, 'Hello from the API');

  assert.equal(calls.statusCreate.length, 1);
  assert.equal(calls.statusCreate[0].status, 'SENT');
  assert.equal(result.id, 100, 'returns the fresh row with statuses');
});

test('sendText reuses a provided conversation and skips contact find-or-create', async () => {
  const { service, calls, messages } = createFakes();

  const result = await service.sendText({ ...TEXT_INPUT, conversationId: 10 });

  assert.equal(calls.ensureContact, 0);
  assert.equal(calls.ensureConversation, 0);
  assert.equal(calls.ensureOpenDeal, 1);
  assert.equal(messages.get(100).conversationId, 10);
  assert.equal(messages.get(100).contactId, 1);
  assert.equal(result.conversationId, 10);
});

test('sendText throws 404 when the provided conversation does not exist', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.sendText({ ...TEXT_INPUT, conversationId: 999 }),
    (err) => err.code === 'CONVERSATION_NOT_FOUND' && err.statusCode === 404
  );
});

test('sendText with an explicit dealId skips open-deal resolution', async () => {
  const { service, calls, messages } = createFakes();

  await service.sendText({ ...TEXT_INPUT, dealId: 42 });

  assert.equal(calls.ensureOpenDeal, 0);
  assert.equal(messages.get(100).dealId, 42);
});

test('sendText marks the message FAILED on provider error but still returns the row', async () => {
  const { service, calls, whatsbox, messages } = createFakes();
  whatsbox.sendText = async () => {
    throw new Error('provider rejected message');
  };

  const result = await service.sendText(TEXT_INPUT);

  assert.equal(result.id, 100);
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /provider rejected message/);
  assert.equal(calls.statusCreate.length, 1);
  assert.equal(calls.statusCreate[0].status, 'FAILED');
  assert.equal(messages.get(100).whatsboxMessageId, undefined, 'no id backfilled on failure');
});

test('sendText propagates validation errors from contact resolution', async () => {
  const { service, conversationService } = createFakes();
  conversationService.ensureContact = async () => {
    throw new AppError('Invalid phone number', 400, null, 'INVALID_PHONE');
  };

  await assert.rejects(() => service.sendText({ ...TEXT_INPUT, to: 'abc' }), (err) => err.code === 'INVALID_PHONE');
});

// --------------------------------------------------------------- sendMedia

test('sendMedia maps WhatsBox type to a local Message.type and sends', async () => {
  const { service, calls, messages } = createFakes();

  const result = await service.sendMedia({
    to: '15551234567',
    type: 'image',
    link: 'https://cdn.example.com/photo.jpg',
    caption: 'Here is the photo',
    filename: 'photo.jpg',
  });

  const message = messages.get(100);
  assert.equal(message.type, 'IMAGE');
  assert.equal(message.mediaUrl, 'https://cdn.example.com/photo.jpg');
  assert.equal(message.mediaName, 'photo.jpg');
  assert.equal(message.caption, 'Here is the photo');
  assert.equal(message.status, 'SENT');

  const send = calls.sends[0];
  assert.equal(send.kind, 'media');
  assert.equal(send.type, 'image');
  assert.equal(send.link, 'https://cdn.example.com/photo.jpg');
  assert.equal(result.id, 100);
});

test('sendMedia stores PDF type for document files ending in .pdf', async () => {
  const { service, messages } = createFakes();

  await service.sendMedia({
    to: '15551234567',
    type: 'document',
    link: 'https://cdn.example.com/invoice.pdf',
    filename: 'invoice.pdf',
  });

  assert.equal(messages.get(100).type, 'PDF');
});

test('sendMedia keeps DOCUMENT type for non-PDF documents', async () => {
  const { service, messages } = createFakes();

  await service.sendMedia({
    to: '15551234567',
    type: 'document',
    link: 'https://cdn.example.com/spec.docx',
    filename: 'spec.docx',
  });

  assert.equal(messages.get(100).type, 'DOCUMENT');
});

test('sendMedia rejects an unsupported WhatsBox media type', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.sendMedia({ to: '15551234567', type: 'sticker', link: 'https://cdn.example.com/x.webp' }),
    (err) => err.code === 'INVALID_MEDIA_TYPE'
  );
});

test('sendMedia marks the message FAILED when the provider errors', async () => {
  const { service, whatsbox, messages } = createFakes();
  whatsbox.sendMedia = async () => {
    throw new Error('media upload failed');
  };

  const result = await service.sendMedia({
    to: '15551234567',
    type: 'audio',
    link: 'https://cdn.example.com/note.mp3',
  });

  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /media upload failed/);
});
