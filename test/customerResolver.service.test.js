const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CustomerResolverService } = require('../src/services/customerResolver.service');
const { IncomingMessageHandler } = require('../src/webhooks/whatsbox/handlers/incomingMessage.handler');
const { OutgoingMessageService } = require('../src/services/outgoingMessage.service');
const { AutoReplyService } = require('../src/services/autoReply.service');

// ------------------------------------------------------------------ helpers

/**
 * Builds a fully in-memory fake ConversationService that mimics the
 * real ensureContact / ensureConversation / ensureOpenDeal logic using
 * plain Maps, with no Prisma / DB involvement.
 */
function buildFakeConversationService() {
  const contacts = new Map();     // whatsappPhone -> contact row
  const conversations = new Map(); // `${contactId}:${channel}` -> conv row
  const deals = new Map();        // Number(deal.ID) -> deal row
  let contactSeq = 1;
  let convSeq = 1;
  let dealSeq = 1;

  const calls = {
    ensureContact: 0,
    ensureConversation: 0,
    ensureOpenDeal: 0,
    saveMessage: 0,
  };

  const svc = {
    _contacts: contacts,
    _conversations: conversations,
    _deals: deals,
    calls,

    async ensureContact({ phone, name, firstName, lastName, email, company }) {
      calls.ensureContact += 1;
      if (contacts.has(phone)) {
        return { contact: contacts.get(phone), created: false };
      }
      const contact = {
        id: contactSeq++,
        whatsappPhone: phone,
        name: name || firstName || null,
        firstName: firstName || null,
        lastName: lastName || null,
        email: email || null,
        company: company || null,
        bitrix24ContactId: 500 + contactSeq,
        syncStatus: 'SYNCED',
      };
      contacts.set(phone, contact);
      return { contact, created: true };
    },

    async ensureConversation({ contactId, channelNumber, provider = 'WHATSBOX', phoneNumberId = null }) {
      calls.ensureConversation += 1;
      const key = `${contactId}:${channelNumber}`;
      if (conversations.has(key)) {
        return { conversation: conversations.get(key), created: false };
      }
      const conv = {
        id: convSeq++,
        contactId,
        channelNumber,
        provider,
        phoneNumberId,
        status: 'OPEN',
        assignedAgentId: null,
        dealId: null,
        bitrix24ExternalChatId: null,
      };
      conversations.set(key, conv);
      return { conversation: conv, created: true };
    },

    async ensureOpenDeal({ contact, conversation, firstMessageBody }) {
      calls.ensureOpenDeal += 1;
      // Reuse deal already on the conversation
      if (conversation.dealId && deals.has(conversation.dealId)) {
        return { deal: deals.get(conversation.dealId), created: false };
      }
      // Reuse any open deal for this contact
      for (const d of deals.values()) {
        if (d.contactId === contact.id && !d.closed) {
          conversation.dealId = Number(d.ID);
          return { deal: d, created: false };
        }
      }
      // Create new deal
      const d = {
        ID: String(dealSeq++),
        contactId: contact.id,
        title: `WhatsApp — ${contact.name || contact.whatsappPhone}`,
        closed: false,
      };
      deals.set(Number(d.ID), d);
      conversation.dealId = Number(d.ID);
      return { deal: d, created: true };
    },

    async saveMessage(input) {
      calls.saveMessage += 1;
      return { id: 100, ...input };
    },

    async updateOutgoingMessageId() {},
    async recordMessageStatus() {},
  };

  return svc;
}

// =========================================================================
// CustomerResolverService unit tests
// =========================================================================

test('new phone → creates contact AND lead (deal)', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  const result = await resolver.resolveCustomerAndLead({
    phone: '15550001111',
    name: 'Alice',
    channelNumber: '15558887777',
  });

  assert.equal(result.contactCreated, true);
  assert.equal(result.dealCreated, true);
  assert.equal(result.contact.whatsappPhone, '15550001111');
  assert.ok(result.deal && result.deal.ID);
  assert.equal(svc._contacts.size, 1);
  assert.equal(svc._deals.size, 1);
});

test('same phone twice → reuses contact AND lead, no duplicates', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  const first = await resolver.resolveCustomerAndLead({ phone: '15550002222', name: 'Bob' });
  assert.equal(first.contactCreated, true);
  assert.equal(first.dealCreated, true);

  const second = await resolver.resolveCustomerAndLead({ phone: '15550002222', name: 'Bob Again' });
  assert.equal(second.contactCreated, false, 'should NOT create a duplicate contact');
  assert.equal(second.dealCreated, false, 'should NOT create a duplicate deal');
  assert.equal(second.contact.id, first.contact.id);
  assert.equal(second.deal.ID, first.deal.ID);
  assert.equal(svc._contacts.size, 1, 'exactly one contact in store');
  assert.equal(svc._deals.size, 1, 'exactly one deal in store');
});

test('contact exists without lead → creates only the lead', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  // Pre-seed a contact so ensureContact returns created:false
  await resolver.resolveCustomerAndLead({ phone: '15550003333', name: 'Carol' });
  // Clear deals to simulate "contact exists but no lead"
  svc._deals.clear();
  // Also clear conversation dealId
  for (const c of svc._conversations.values()) c.dealId = null;
  svc.calls.ensureOpenDeal = 0;

  const result = await resolver.resolveCustomerAndLead({ phone: '15550003333', name: 'Carol' });
  assert.equal(result.contactCreated, false, 'contact already existed');
  assert.equal(result.dealCreated, true, 'new deal should be created');
  assert.equal(svc._contacts.size, 1);
  assert.equal(svc._deals.size, 1);
});

test('multiple different phones → separate contacts and leads, no cross-contamination', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  await resolver.resolveCustomerAndLead({ phone: '15550004444', name: 'Dan' });
  await resolver.resolveCustomerAndLead({ phone: '15550005555', name: 'Eve' });
  await resolver.resolveCustomerAndLead({ phone: '15550006666', name: 'Frank' });

  assert.equal(svc._contacts.size, 3, 'three distinct contacts');
  assert.equal(svc._deals.size, 3, 'three distinct deals');
});

// =========================================================================
// Outgoing / Campaign message tests (OutgoingMessageService)
// =========================================================================

test('campaign sendText to new phone → creates contact and lead before sending', async () => {
  const svc = buildFakeConversationService();
  const messages = new Map();

  const service = new OutgoingMessageService({
    conversationService: svc,
    whatsbox: {
      async sendText() { return { whatsboxMessageId: 'wb_campaign_1' }; },
    },
    messageRepo: {
      async findById(id) { return messages.get(id) || null; },
      async updateStatus(id, status, opts = {}) {
        const row = messages.get(id);
        row.status = status;
        if (opts.sentAt) row.sentAt = opts.sentAt;
        return row;
      },
    },
    conversationRepo: {
      async findById() { return null; },
    },
  });

  // Override saveMessage to track rows
  svc.saveMessage = async (input) => {
    svc.calls.saveMessage += 1;
    const row = { id: 200, ...input, status: 'PENDING' };
    messages.set(200, row);
    return row;
  };

  await service.sendText({ to: '15550007777', body: 'Campaign Offer!' });

  assert.equal(svc._contacts.size, 1, 'contact created for new campaign recipient');
  assert.equal(svc._deals.size, 1, 'lead created for new campaign recipient');
  // resolveCustomer calls ensureContact (1×); _resolveDealId calls ensureOpenDeal (1×)
  assert.equal(svc.calls.ensureContact, 1, 'ensureContact called exactly once');
  assert.equal(svc.calls.ensureOpenDeal, 1, 'ensureOpenDeal called exactly once via _resolveDealId');
});

test('campaign sendText to existing customer → reuses existing lead, no duplicate', async () => {
  const svc = buildFakeConversationService();
  const messages = new Map();
  let msgId = 300;

  svc.saveMessage = async (input) => {
    const row = { id: msgId++, ...input, status: 'PENDING' };
    messages.set(row.id, row);
    return row;
  };

  const service = new OutgoingMessageService({
    conversationService: svc,
    whatsbox: { async sendText() { return { whatsboxMessageId: 'wb_camp_2' }; } },
    messageRepo: {
      async findById(id) { return messages.get(id) || null; },
      async updateStatus(id, status, opts = {}) {
        const row = messages.get(id);
        row.status = status;
        if (opts.sentAt) row.sentAt = opts.sentAt;
        return row;
      },
    },
    conversationRepo: { async findById() { return null; } },
  });

  // First campaign message creates the customer + lead
  await service.sendText({ to: '15550008888', body: 'First campaign' });
  assert.equal(svc._contacts.size, 1);
  assert.equal(svc._deals.size, 1);

  // Second campaign message to the same number must NOT create duplicates
  await service.sendText({ to: '15550008888', body: 'Second campaign' });
  assert.equal(svc._contacts.size, 1, 'still only one contact');
  assert.equal(svc._deals.size, 1, 'still only one deal/lead');
});

// =========================================================================
// Auto-reply (Automated Message) tests
// =========================================================================

test('auto-reply to new customer → creates contact and lead before replying', async () => {
  const svc = buildFakeConversationService();
  const messages = new Map();

  svc.saveMessage = async (input) => {
    const row = { id: 400, ...input, status: 'PENDING' };
    messages.set(400, row);
    return row;
  };

  // Resolve a brand-new customer (creates contact + deal)
  const resolver = new CustomerResolverService({ conversationService: svc });
  const { contact, conversation } = await resolver.resolveCustomerAndLead({
    phone: '15550009999',
    name: 'Grace',
  });

  // Build the outgoing service AFTER resolving so the conversationRepo
  // can return the real conversation (needed when sendText passes conversationId).
  const outgoing = new OutgoingMessageService({
    conversationService: svc,
    whatsbox: { async sendText() { return { whatsboxMessageId: 'wb_auto_1' }; } },
    messageRepo: {
      async findById(id) { return messages.get(id) || null; },
      async updateStatus(id, status, opts = {}) {
        const row = messages.get(id);
        row.status = status;
        if (opts.sentAt) row.sentAt = opts.sentAt;
        return row;
      },
    },
    conversationRepo: {
      async findById(id) {
        return id === conversation.id ? { ...conversation, contact } : null;
      },
    },
  });

  const autoReply = new AutoReplyService({
    settingService: {
      async getValue(key, fallback) {
        if (key === 'AUTO_REPLY_ENABLED') return true;
        if (key === 'AUTO_REPLY_BODY') return 'Thank you for contacting us!';
        // Both false: unassigned conversations reply; reply is always sent
        if (key === 'AUTO_REPLY_SKIP_ASSIGNED') return false;
        if (key === 'AUTO_REPLY_ONCE_PER_CONTACT') return false;
        return fallback;
      },
    },
    templateService: { render(body) { return body; } },
    autoReplyLogRepo: {
      async hasAutoReplied() { return false; },
      async record() {},
    },
    outgoingMessageService: outgoing,
  });

  // auto-reply calls outgoing.sendText → resolveCustomer reuses the existing
  // contact + conversation (no duplicate) → _resolveDealId reuses existing deal
  const result = await autoReply.maybeReply({ conversation, contact });
  assert.equal(result.replied, true, 'auto-reply should fire');
  assert.equal(svc._contacts.size, 1, 'exactly one contact — no duplicate');
  assert.equal(svc._deals.size, 1, 'exactly one deal — no duplicate');
});

// =========================================================================
// Incoming WhatsApp Webhook tests (IncomingMessageHandler)
// =========================================================================

test('incoming message from new number → CustomerResolverService creates contact + deal once', async () => {
  const svc = buildFakeConversationService();

  const handler = new IncomingMessageHandler({
    conversationService: svc,
    messageRepo: {
      async findByWhatsboxMessageId() { return null; },
    },
    conversationRepo: {
      async reopen() {},
      async update() { return {}; },
    },
    agentRepo: { async findById() { return null; } },
    bitrix24: {
      async createTimelineComment() {},
      async notifyUser() {},
    },
    connectorService: {
      async sendCustomerMessage() { return { sent: true }; },
    },
    routingService: {
      async assignIfNeeded() { return { assigned: false }; },
    },
    autoReplyService: {
      async maybeReply() { return { replied: false }; },
    },
  });

  const result = await handler.handle({
    event: 'message',
    messageId: 'wb_in_2001',
    from: '15551112222',
    fromName: 'Incoming User',
    channelId: '15559998888',
    type: 'TEXT',
    body: 'Hello support',
    timestamp: new Date(),
  });

  assert.equal(result.handled, true);
  assert.equal(svc._contacts.size, 1, 'exactly one contact created');
  assert.equal(svc._deals.size, 1, 'exactly one deal created');
});

test('two incoming messages from same number → no duplicate contact or deal', async () => {
  const svc = buildFakeConversationService();
  let msgSeq = 0;

  const handler = new IncomingMessageHandler({
    conversationService: svc,
    messageRepo: {
      // Return null on first (new), then null again for second unique id
      async findByWhatsboxMessageId() { return null; },
    },
    conversationRepo: {
      async reopen() {},
      async update() { return {}; },
    },
    agentRepo: { async findById() { return null; } },
    bitrix24: {
      async createTimelineComment() {},
      async notifyUser() {},
    },
    connectorService: {
      async sendCustomerMessage() { return { sent: true }; },
    },
    routingService: {
      async assignIfNeeded() { return { assigned: false }; },
    },
    autoReplyService: {
      async maybeReply() { return { replied: false }; },
    },
  });

  await handler.handle({
    event: 'message', messageId: `wb_dup_${++msgSeq}`,
    from: '15553334444', fromName: 'Repeat User',
    channelId: '15559998888', type: 'TEXT',
    body: 'First message', timestamp: new Date(),
  });

  await handler.handle({
    event: 'message', messageId: `wb_dup_${++msgSeq}`,
    from: '15553334444', fromName: 'Repeat User',
    channelId: '15559998888', type: 'TEXT',
    body: 'Second message', timestamp: new Date(),
  });

  assert.equal(svc._contacts.size, 1, 'same contact reused — no duplicate');
  assert.equal(svc._deals.size, 1, 'same deal reused — no duplicate');
});
