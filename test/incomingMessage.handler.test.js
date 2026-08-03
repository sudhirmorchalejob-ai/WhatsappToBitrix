const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessageHandler } = require('../src/webhooks/whatsbox/handlers/incomingMessage.handler');

// ------------------------------------------------------------------ fakes

function createFakes({ assignedAgentId = null, conversationStatus = 'OPEN' } = {}) {
  const calls = {
    ensureContact: [],
    ensureConversation: [],
    ensureOpenDeal: [],
    saveMessage: [],
    dedup: [],
    reopen: [],
    convUpdate: [],
    forward: [],
    timeline: [],
    notify: [],
    agentLookup: [],
    routing: [],
    autoReply: [],
  };

  const messageRepo = {
    findByWhatsboxMessageId: async (id) => {
      calls.dedup.push(id);
      return null;
    },
  };

  const conversationRepo = {
    reopen: async (id) => {
      calls.reopen.push(id);
    },
    update: async (id, data) => {
      calls.convUpdate.push({ id, data });
      return { id, ...data };
    },
  };

  const connectorService = {
    sendCustomerMessage: async (input) => {
      calls.forward.push(input);
      return { sent: true, result: {} };
    },
  };

  const agentRepo = {
    findById: async (id) => {
      calls.agentLookup.push(id);
      return { id, bitrix24UserId: 701 };
    },
  };

  const bitrix24 = {
    createTimelineComment: async (input) => {
      calls.timeline.push(input);
      return 1;
    },
    notifyUser: async (input) => {
      calls.notify.push(input);
      return 1;
    },
  };

  const service = {
    ensureContact: async (input) => {
      calls.ensureContact.push(input);
      return {
        contact: {
          id: 1,
          whatsappPhone: input.phone,
          name: input.name,
          firstName: input.name,
          bitrix24ContactId: 55,
        },
        created: true,
      };
    },
    ensureConversation: async (input) => {
      calls.ensureConversation.push(input);
      const { contactId, channelNumber } = input;
      return {
        conversation: {
          id: 10,
          contactId,
          channelNumber,
          dealId: null,
          status: conversationStatus,
          assignedAgentId,
        },
        created: true,
      };
    },
    ensureOpenDeal: async ({ contact, conversation, firstMessageBody }) => {
      calls.ensureOpenDeal.push({ contact, conversation, firstMessageBody });
      return { deal: { ID: 12 }, created: true };
    },
    saveMessage: async (input) => {
      calls.saveMessage.push(input);
      return { id: 100, ...input };
    },
  };

  const routingService = {
    assignIfNeeded: async ({ conversation, contact }) => {
      calls.routing.push({ conversation, contact });
      return { assigned: false, reason: 'no-agents' };
    },
  };

  const autoReplyService = {
    maybeReply: async ({ conversation, contact }) => {
      calls.autoReply.push({ conversation, contact });
      return { replied: false, reason: 'disabled' };
    },
  };

  const handler = new IncomingMessageHandler({
    conversationService: service,
    messageRepo,
    conversationRepo,
    agentRepo,
    bitrix24,
    connectorService,
    routingService,
    autoReplyService,
  });

  return { handler, calls, routingService, autoReplyService };
}

// ------------------------------------------------------------------ canonical

function textCanonical(overrides = {}) {
  return {
    event: 'message',
    provider: 'WHATSBOX',
    channelId: '15551234567',
    messageId: 'msg-123',
    from: '15551234567',
    fromName: 'John Doe',
    timestamp: new Date('2026-01-01T10:00:00Z'),
    type: 'TEXT',
    body: 'Hello there',
    caption: null,
    mediaUrl: null,
    mediaMimeType: null,
    mediaName: null,
    mediaSize: null,
    locationData: null,
    contactCard: null,
    raw: {},
    ...overrides,
  };
}

// --------------------------------------------------------------- tests

test('full happy path: dedup -> contact -> conversation -> deal -> save -> timeline', async () => {
  const { handler, calls } = createFakes();

  const result = await handler.handle(textCanonical());

  assert.equal(result.handled, true);
  assert.equal(result.messageId, 100);
  assert.equal(result.contactId, 1);
  assert.equal(result.conversationId, 10);
  assert.equal(result.dealId, 12);

  assert.deepEqual(calls.dedup, ['msg-123']);
  assert.equal(calls.ensureContact.length, 1);
  assert.deepEqual(calls.ensureConversation[0], {
    contactId: 1,
    channelNumber: '15551234567',
    provider: 'WHATSBOX',
    phoneNumberId: null,
  });
  assert.equal(calls.ensureOpenDeal.length, 1);

  const saved = calls.saveMessage[0];
  assert.equal(saved.direction, 'INCOMING');
  assert.equal(saved.status, 'SENT');
  assert.equal(saved.dealId, 12);
  assert.equal(saved.whatsboxMessageId, 'msg-123');
  assert.equal(saved.conversation.id, 10);
  assert.equal(saved.contact.id, 1);

  // Open Channels external chat id is persisted once and reused for the forward.
  assert.deepEqual(calls.convUpdate, [{ id: 10, data: { bitrix24ExternalChatId: 'wa_10' } }]);
  assert.equal(calls.forward.length, 1);
  assert.equal(calls.forward[0].chatId, 'wa_10');
  assert.equal(calls.forward[0].messageId, 100);
  assert.equal(calls.forward[0].contactName, 'John Doe');
  assert.equal(calls.forward[0].body, 'Hello there');

  assert.equal(calls.timeline.length, 1);
  assert.equal(calls.timeline[0].entityType, 'deal');
  assert.equal(calls.timeline[0].entityId, 12);
  assert.match(calls.timeline[0].comment, /Hello there/);

  assert.equal(calls.notify.length, 0, 'no notification when unassigned');
  assert.equal(calls.reopen.length, 0);
});

test('conversation already linked to an external chat id is not re-persisted', async () => {
  const { handler, calls } = createFakes();
  handler.service.ensureConversation = async ({ contactId, channelNumber }) => ({
    conversation: {
      id: 10,
      contactId,
      channelNumber,
      dealId: null,
      status: 'OPEN',
      assignedAgentId: null,
      bitrix24ExternalChatId: 'wa_999',
    },
    created: false,
  });

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.deepEqual(calls.convUpdate, [], 'no re-persist for an existing chat id');
  assert.equal(calls.forward.length, 1);
  assert.equal(calls.forward[0].chatId, 'wa_999');
});

test('forwarding is skipped when the open line is not configured', async () => {
  const { handler, calls } = createFakes();
  handler.connectorService.sendCustomerMessage = async (input) => {
    calls.forward.push(input);
    return { sent: false, skipped: 'openline-not-configured' };
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.forward.length, 1);
  assert.equal(calls.saveMessage.length, 1, 'message still stored');
});

test('open-line forwarding failure is non-fatal', async () => {
  const { handler, calls } = createFakes();
  handler.connectorService.sendCustomerMessage = async () => {
    throw new Error('b24 down');
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.saveMessage.length, 1, 'message still stored');
  assert.equal(calls.timeline.length, 1, 'timeline still written');
});

test('duplicate provider message id is skipped without side effects', async () => {
  const { handler, calls } = createFakes();
  handler.messageRepo.findByWhatsboxMessageId = async () => ({ id: 99 });

  const result = await handler.handle(textCanonical());

  assert.equal(result.handled, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'duplicate');
  assert.equal(calls.ensureContact.length, 0);
  assert.equal(calls.saveMessage.length, 0);
  assert.equal(calls.timeline.length, 0);
});

test('a Meta inbound message persists the provider and Meta phone number id on the conversation', async () => {
  const { handler, calls } = createFakes();
  await handler.handle(textCanonical({ provider: 'META', channelId: '15550000000', phoneNumberId: '1077' }));
  assert.deepEqual(calls.ensureConversation[0], {
    contactId: 1,
    channelNumber: '15550000000',
    provider: 'META',
    phoneNumberId: '1077',
  });
});

test('message without sender phone is skipped', async () => {
  const { handler, calls } = createFakes();
  const result = await handler.handle(textCanonical({ from: null, messageId: null }));
  assert.equal(result.reason, 'no-sender-phone');
  assert.equal(calls.ensureContact.length, 0);
});

test('contact card message feeds name and email into contact creation', async () => {
  const { handler, calls } = createFakes();
  await handler.handle(
    textCanonical({
      type: 'CONTACT',
      body: null,
      fromName: null,
      contactCard: { name: 'Jane Smith', phones: ['15559876543'], email: 'jane@example.com' },
    })
  );
  const contactInput = calls.ensureContact[0];
  assert.equal(contactInput.phone, '15551234567');
  assert.equal(contactInput.firstName, 'Jane Smith');
  assert.equal(contactInput.email, 'jane@example.com');
});

test('a closed conversation is reopened on new activity', async () => {
  const { handler, calls } = createFakes({ conversationStatus: 'CLOSED' });
  await handler.handle(textCanonical());
  assert.deepEqual(calls.reopen, [10]);
});

test('assigned agent receives a push notification', async () => {
  const { handler, calls } = createFakes({ assignedAgentId: 7 });
  await handler.handle(textCanonical({ body: 'Support needed!' }));

  assert.deepEqual(calls.agentLookup, [7]);
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.notify[0].toUserId, 701);
  assert.equal(calls.notify[0].type, 'USER');
  assert.match(calls.notify[0].message, /John Doe/);
  assert.match(calls.notify[0].message, /Support needed!/);
});

test('agent notification failure is non-fatal', async () => {
  const { handler, calls } = createFakes({ assignedAgentId: 7 });
  handler.bitrix24.notifyUser = async () => {
    throw new Error('notify down');
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.timeline.length, 1, 'timeline still written');
});

test('timeline comment failure is non-fatal', async () => {
  const { handler, calls } = createFakes();
  handler.bitrix24.createTimelineComment = async () => {
    throw new Error('b24 down');
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.saveMessage.length, 1, 'message still stored');
});

test('media message produces a timeline comment with the media URL', async () => {
  const { handler, calls } = createFakes();
  await handler.handle(
    textCanonical({
      type: 'IMAGE',
      body: null,
      caption: 'Invoice scan',
      mediaUrl: 'https://cdn.whatsbox.io/files/abc.jpg',
      mediaName: 'invoice.jpg',
    })
  );
  const comment = calls.timeline[0].comment;
  assert.match(comment, /Image: Invoice scan — invoice\.jpg/);
  assert.match(comment, /https:\/\/cdn\.whatsbox\.io\/files\/abc\.jpg/);
});

test('media message is forwarded to the open line with a readable description', async () => {
  const { handler, calls } = createFakes();
  await handler.handle(
    textCanonical({
      type: 'IMAGE',
      body: null,
      caption: 'Invoice scan',
      mediaUrl: 'https://cdn.whatsbox.io/files/abc.jpg',
      mediaName: 'invoice.jpg',
    })
  );
  const forwarded = calls.forward[0];
  assert.equal(forwarded.chatId, 'wa_10');
  assert.match(forwarded.body, /Image: Invoice scan — invoice\.jpg/);
  assert.match(forwarded.body, /https:\/\/cdn\.whatsbox\.io\/files\/abc\.jpg/);
});

test('timeline comment falls back to the contact when no deal exists', async () => {
  const { handler, calls } = createFakes();
  handler.service.ensureOpenDeal = async () => ({ deal: null, created: false, skipped: 'contact-not-synced' });
  handler.service.saveMessage = async (input) => ({ id: 100, ...input });

  const result = await handler.handle(textCanonical());
  assert.equal(result.dealId, null);
  assert.equal(calls.timeline.length, 1);
  assert.equal(calls.timeline[0].entityType, 'contact');
  assert.equal(calls.timeline[0].entityId, 55);
});

test('non-message events are skipped by the handler', async () => {
  const { handler, calls } = createFakes();
  const result = await handler.handle({ event: 'status', status: 'DELIVERED' });
  assert.equal(result.reason, 'not-a-message-event');
  assert.equal(calls.ensureContact.length, 0);
});

test('an unassigned conversation is auto-routed and the routed agent is notified', async () => {
  const { handler, calls, routingService } = createFakes();
  routingService.assignIfNeeded = async ({ conversation, contact }) => {
    calls.routing.push({ conversation, contact });
    return { assigned: true, agentId: 7, reason: 'auto', agent: { id: 7 } };
  };

  const result = await handler.handle(textCanonical({ body: 'Who can help?' }));
  assert.equal(result.handled, true);

  assert.equal(calls.routing.length, 1);
  assert.equal(calls.routing[0].conversation.id, 10);
  assert.equal(calls.routing[0].contact.id, 1);

  // The routed agent receives the push notification.
  assert.deepEqual(calls.agentLookup, [7]);
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.notify[0].toUserId, 701);
  assert.match(calls.notify[0].message, /Who can help\?/);
});

test('routing is skipped when the conversation is already assigned', async () => {
  const { handler, calls } = createFakes({ assignedAgentId: 7 });
  await handler.handle(textCanonical());
  assert.equal(calls.routing.length, 0, 'no routing attempt for an assigned conversation');
  assert.equal(calls.agentLookup.length, 1, 'assigned agent still notified');
});

test('a routing failure is non-fatal', async () => {
  const { handler, calls, routingService } = createFakes();
  routingService.assignIfNeeded = async () => {
    throw new Error('routing down');
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.saveMessage.length, 1, 'message still stored');
  assert.equal(calls.timeline.length, 1, 'timeline still written');
  assert.equal(calls.notify.length, 0);
});

test('the auto-reply service is consulted with the conversation and contact', async () => {
  const { handler, calls, autoReplyService } = createFakes();
  autoReplyService.maybeReply = async ({ conversation, contact }) => {
    calls.autoReply.push({ conversation, contact });
    return { replied: true, messageId: 200, body: 'Thanks, we will reply soon!' };
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.autoReply.length, 1);
  assert.equal(calls.autoReply[0].conversation.id, 10);
  assert.equal(calls.autoReply[0].contact.id, 1);
});

test('an auto-reply failure is non-fatal', async () => {
  const { handler, calls, autoReplyService } = createFakes();
  autoReplyService.maybeReply = async () => {
    throw new Error('auto-reply down');
  };

  const result = await handler.handle(textCanonical());
  assert.equal(result.handled, true);
  assert.equal(calls.saveMessage.length, 1, 'message still stored');
  assert.equal(calls.timeline.length, 1, 'timeline still written');
});
