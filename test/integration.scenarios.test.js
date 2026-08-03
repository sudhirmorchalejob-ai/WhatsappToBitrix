/**
 * Integration Scenario Tests — 15 Minimum Scenarios
 * ===================================================
 * Each scenario is self-contained and uses only in-memory fakes.
 * No Prisma, no real HTTP, no external services.
 *
 * Coverage:
 *  S01 - First-ever inbound message: contact + deal created, message saved
 *  S02 - Duplicate inbound (same messageId): idempotency guard fires
 *  S03 - Second message from same phone: contact & deal REUSED, no duplicate
 *  S04 - Closed conversation reopened on new inbound message
 *  S05 - Campaign (outbound) to new number: contact + deal created
 *  S06 - Campaign to existing customer: existing deal reused, no new deal
 *  S07 - Explicit dealId on sendText: deal resolution completely skipped
 *  S08 - Provider failure on sendText: message marked FAILED, row returned
 *  S09 - Auto-reply disabled: returns replied=false without sending anything
 *  S10 - Auto-reply once-per-contact: second message does NOT get a reply
 *  S11 - Auto-reply skips assigned conversations (operator owns chat)
 *  S12 - Auto-reply via fallback default template (no AUTO_REPLY_BODY set)
 *  S13 - Multiple different customers in parallel: zero cross-contamination
 *  S14 - resolveCustomer (no deal) vs resolveCustomerAndLead (with deal)
 *  S15 - Media (sendMedia) outbound to new number: contact + deal created
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CustomerResolverService } = require('../src/services/customerResolver.service');
const { IncomingMessageHandler } = require('../src/webhooks/whatsbox/handlers/incomingMessage.handler');
const { OutgoingMessageService } = require('../src/services/outgoingMessage.service');
const { AutoReplyService } = require('../src/services/autoReply.service');

// ═══════════════════════════════════════════════════════════════════════════
// Shared in-memory fake factory
// ═══════════════════════════════════════════════════════════════════════════

function buildFakeConversationService() {
  const contacts = new Map();      // whatsappPhone → contact row
  const conversations = new Map(); // `${contactId}:${channel}` → conv row
  const deals = new Map();         // dealId (number) → deal row
  let cSeq = 1;
  let vSeq = 100;
  let dSeq = 1000;

  const calls = { ensureContact: 0, ensureConversation: 0, ensureOpenDeal: 0, saveMessage: 0 };

  return {
    _contacts: contacts,
    _conversations: conversations,
    _deals: deals,
    calls,

    async ensureContact({ phone, name, firstName }) {
      calls.ensureContact += 1;
      if (contacts.has(phone)) return { contact: contacts.get(phone), created: false };
      const contact = {
        id: cSeq++,
        whatsappPhone: phone,
        name: name || firstName || null,
        firstName: firstName || null,
        bitrix24ContactId: 500 + cSeq,
        syncStatus: 'SYNCED',
      };
      contacts.set(phone, contact);
      return { contact, created: true };
    },

    async ensureConversation({ contactId, channelNumber, provider = 'WHATSBOX', phoneNumberId = null }) {
      calls.ensureConversation += 1;
      const key = `${contactId}:${channelNumber}`;
      if (conversations.has(key)) return { conversation: conversations.get(key), created: false };
      const conv = {
        id: vSeq++,
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

    async ensureOpenDeal({ contact, conversation }) {
      calls.ensureOpenDeal += 1;
      if (conversation.dealId && deals.has(conversation.dealId)) {
        return { deal: deals.get(conversation.dealId), created: false };
      }
      for (const d of deals.values()) {
        if (d.contactId === contact.id && !d.closed) {
          conversation.dealId = Number(d.ID);
          return { deal: d, created: false };
        }
      }
      const d = { ID: String(dSeq++), contactId: contact.id, closed: false };
      deals.set(Number(d.ID), d);
      conversation.dealId = Number(d.ID);
      return { deal: d, created: true };
    },

    async saveMessage(input) {
      calls.saveMessage += 1;
      return { id: 9000 + calls.saveMessage, ...input };
    },
    async updateOutgoingMessageId() {},
    async recordMessageStatus() {},
  };
}

/** Minimal silent fakes used by IncomingMessageHandler side-effects */
function silentHandlerDeps(svc) {
  return {
    conversationService: svc,
    messageRepo: { async findByWhatsboxMessageId() { return null; } },
    conversationRepo: {
      async reopen(id) { /* mark open */ },
      async update() { return {}; },
    },
    agentRepo: { async findById() { return null; } },
    bitrix24: {
      async createTimelineComment() {},
      async notifyUser() {},
    },
    connectorService: { async sendCustomerMessage() { return { sent: true }; } },
    routingService: { async assignIfNeeded() { return { assigned: false }; } },
    autoReplyService: { async maybeReply() { return { replied: false }; } },
  };
}

/** Minimal whatsbox, messageRepo, conversationRepo for OutgoingMessageService */
function buildOutgoingDeps(svc, conversationOverride = {}) {
  const messages = new Map();
  let msgId = 5000;

  svc.saveMessage = async (input) => {
    const row = { id: ++msgId, ...input, status: 'PENDING' };
    messages.set(msgId, row);
    return row;
  };

  // recordMessageStatus is called by _markFailed / _markSent via the
  // conversationService — patch the fake svc so it updates the messages map.
  const originalSaveMessage = svc.saveMessage.bind(svc);
  svc.saveMessage = async (input) => {
    const row = await originalSaveMessage(input);
    messages.set(row.id, row);
    return row;
  };
  svc.recordMessageStatus = async ({ messageId, status, error }) => {
    const row = messages.get(messageId);
    if (row) { row.status = status; if (error) row.error = error; }
  };

  return {
    conversationService: svc,
    whatsbox: {
      async sendText() { return { whatsboxMessageId: 'wb_sent_1' }; },
      async sendMedia() { return { whatsboxMessageId: 'wb_media_1' }; },
    },
    messageRepo: {
      async findById(id) { return messages.get(id) || null; },
      async updateStatus(id, status, opts = {}) {
        const row = messages.get(id);
        if (row) { row.status = status; if (opts.sentAt) row.sentAt = opts.sentAt; }
        return row;
      },
    },
    conversationRepo: {
      async findById(id) {
        return conversationOverride[id] || null;
      },
    },
    messages,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// S01 — First-ever inbound message: contact + deal created, message saved
// ═══════════════════════════════════════════════════════════════════════════
test('S01: first inbound message → contact and deal created, result.handled=true', async () => {
  const svc = buildFakeConversationService();
  const handler = new IncomingMessageHandler(silentHandlerDeps(svc));

  const result = await handler.handle({
    event: 'message',
    messageId: 'S01-msg',
    from: '12223334444',
    fromName: 'Alice',
    channelId: '15551111000',
    type: 'TEXT',
    body: 'Hello! First contact.',
    timestamp: new Date(),
  });

  assert.equal(result.handled, true, 'S01: handled must be true');
  assert.equal(result.contactId != null, true, 'S01: contactId returned');
  assert.equal(result.conversationId != null, true, 'S01: conversationId returned');
  assert.equal(result.dealId != null, true, 'S01: dealId returned');
  assert.equal(svc._contacts.size, 1, 'S01: exactly one contact');
  assert.equal(svc._deals.size, 1, 'S01: exactly one deal');
  assert.equal(svc.calls.saveMessage, 1, 'S01: message saved exactly once');
});

// ═══════════════════════════════════════════════════════════════════════════
// S02 — Duplicate webhook (same messageId): idempotency guard fires, skipped
// ═══════════════════════════════════════════════════════════════════════════
test('S02: duplicate inbound messageId → skipped without creating contact or deal', async () => {
  const svc = buildFakeConversationService();
  const deps = silentHandlerDeps(svc);
  // Override messageRepo to simulate "already seen this messageId"
  deps.messageRepo = {
    async findByWhatsboxMessageId(id) {
      return id === 'S02-dup' ? { id: 77 } : null;
    },
  };
  const handler = new IncomingMessageHandler(deps);

  const result = await handler.handle({
    event: 'message',
    messageId: 'S02-dup',
    from: '12223330001',
    fromName: 'Bob',
    channelId: '15551111000',
    type: 'TEXT',
    body: 'Repeated message',
    timestamp: new Date(),
  });

  assert.equal(result.skipped, true, 'S02: must be skipped');
  assert.equal(result.reason, 'duplicate', 'S02: reason = duplicate');
  assert.equal(svc._contacts.size, 0, 'S02: no contact created for duplicate');
  assert.equal(svc._deals.size, 0, 'S02: no deal created for duplicate');
});

// ═══════════════════════════════════════════════════════════════════════════
// S03 — Second message from same phone: contact & deal REUSED, no duplicate
// ═══════════════════════════════════════════════════════════════════════════
test('S03: two inbound messages from same phone → contact and deal reused, no duplicates', async () => {
  const svc = buildFakeConversationService();
  let msgCount = 0;
  const deps = {
    ...silentHandlerDeps(svc),
    messageRepo: {
      async findByWhatsboxMessageId() { return null; },  // always new
    },
  };
  deps.conversationRepo = {
    async reopen() {},
    async update() { return {}; },
  };
  const handler = new IncomingMessageHandler(deps);

  await handler.handle({
    event: 'message', messageId: `S03-${++msgCount}`,
    from: '12223330002', fromName: 'Carol',
    channelId: '15551111000', type: 'TEXT',
    body: 'First', timestamp: new Date(),
  });

  await handler.handle({
    event: 'message', messageId: `S03-${++msgCount}`,
    from: '12223330002', fromName: 'Carol',
    channelId: '15551111000', type: 'TEXT',
    body: 'Second', timestamp: new Date(),
  });

  assert.equal(svc._contacts.size, 1, 'S03: same contact reused — only one record');
  assert.equal(svc._deals.size, 1, 'S03: same deal reused — only one record');
  assert.equal(svc.calls.ensureContact, 2, 'S03: ensureContact called twice (once per message)');
  assert.equal(svc.calls.ensureOpenDeal, 2, 'S03: ensureOpenDeal called twice but created only once');
});

// ═══════════════════════════════════════════════════════════════════════════
// S04 — Closed conversation is reopened on new inbound
// ═══════════════════════════════════════════════════════════════════════════
test('S04: inbound message on CLOSED conversation → conversation reopened', async () => {
  const svc = buildFakeConversationService();
  const reopened = [];

  // Pre-seed via the resolver using the SAME channel the handler will use.
  // The handler calls resolveCustomerAndLead with channelId as channelNumber,
  // so we must match that exact channel key.
  const PHONE = '12223330003';
  const CHANNEL = '15551111000';
  const resolver = new CustomerResolverService({ conversationService: svc });
  await resolver.resolveCustomerAndLead({ phone: PHONE, name: 'Dave', channelNumber: CHANNEL });

  // Mark that conversation CLOSED
  const conv = svc._conversations.get(`1:${CHANNEL}`);
  assert.ok(conv, 'S04: pre-seeded conversation must exist');
  conv.status = 'CLOSED';

  const deps = {
    ...silentHandlerDeps(svc),
    messageRepo: { async findByWhatsboxMessageId() { return null; } },
    conversationRepo: {
      async reopen(id) { reopened.push(id); conv.status = 'OPEN'; },
      async update() { return {}; },
    },
  };
  const handler = new IncomingMessageHandler(deps);

  await handler.handle({
    event: 'message', messageId: 'S04-msg',
    from: PHONE, fromName: 'Dave',
    channelId: CHANNEL, type: 'TEXT',
    body: 'I need help again', timestamp: new Date(),
  });

  assert.equal(reopened.length >= 1, true, 'S04: reopen() called on the closed conversation');
  assert.equal(conv.status, 'OPEN', 'S04: conversation status is now OPEN');
});

// ═══════════════════════════════════════════════════════════════════════════
// S05 — Campaign sendText to brand-new number: contact + deal created
// ═══════════════════════════════════════════════════════════════════════════
test('S05: campaign sendText to new number → contact and deal created', async () => {
  const svc = buildFakeConversationService();
  const { messages, ...deps } = buildOutgoingDeps(svc);
  const service = new OutgoingMessageService(deps);

  const result = await service.sendText({ to: '12223330004', body: 'Campaign offer!' });

  assert.equal(svc._contacts.size, 1, 'S05: contact created');
  assert.equal(svc._deals.size, 1, 'S05: deal created');
  assert.equal(result.status, 'SENT', 'S05: message status is SENT');
  assert.equal(result.type, 'TEXT', 'S05: type is TEXT');
});

// ═══════════════════════════════════════════════════════════════════════════
// S06 — Campaign to existing customer: existing deal reused
// ═══════════════════════════════════════════════════════════════════════════
test('S06: campaign to existing customer → existing deal reused, zero new contacts or deals', async () => {
  const svc = buildFakeConversationService();
  // Pre-create via first send
  const d1 = buildOutgoingDeps(svc);
  await new OutgoingMessageService(d1).sendText({ to: '12223330005', body: 'First promo' });

  assert.equal(svc._contacts.size, 1);
  assert.equal(svc._deals.size, 1);

  // Second campaign → same number
  const d2 = buildOutgoingDeps(svc);
  await new OutgoingMessageService(d2).sendText({ to: '12223330005', body: 'Second promo' });

  assert.equal(svc._contacts.size, 1, 'S06: still only one contact');
  assert.equal(svc._deals.size, 1, 'S06: still only one deal — no duplicate');
});

// ═══════════════════════════════════════════════════════════════════════════
// S07 — Explicit dealId on sendText: deal resolution completely skipped
// ═══════════════════════════════════════════════════════════════════════════
test('S07: sendText with explicit dealId → ensureOpenDeal never called', async () => {
  const svc = buildFakeConversationService();
  const { messages, ...deps } = buildOutgoingDeps(svc);
  const service = new OutgoingMessageService(deps);

  await service.sendText({ to: '12223330006', body: 'With explicit deal', dealId: 42 });

  assert.equal(svc.calls.ensureOpenDeal, 0, 'S07: ensureOpenDeal must NOT be called');
  // A contact + conversation IS still resolved (needed for routing)
  assert.equal(svc._contacts.size, 1, 'S07: contact was still resolved');
});

// ═══════════════════════════════════════════════════════════════════════════
// S08 — Provider failure on sendText: message FAILED but row is returned
// ═══════════════════════════════════════════════════════════════════════════
test('S08: provider error during sendText → message marked FAILED, row returned', async () => {
  const svc = buildFakeConversationService();
  const { messages, ...deps } = buildOutgoingDeps(svc);
  deps.whatsbox.sendText = async () => { throw new Error('WhatsBox timeout'); };

  const service = new OutgoingMessageService(deps);
  const result = await service.sendText({ to: '12223330007', body: 'Will fail' });

  assert.equal(result.status, 'FAILED', 'S08: status must be FAILED after provider error');
  assert.match(result.error, /WhatsBox timeout/, 'S08: error text is preserved');
});

// ═══════════════════════════════════════════════════════════════════════════
// S09 — Auto-reply disabled: nothing sent
// ═══════════════════════════════════════════════════════════════════════════
test('S09: AUTO_REPLY_ENABLED=false → replied=false, nothing sent', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });
  const { contact, conversation } = await resolver.resolveCustomerAndLead({
    phone: '12223330008', name: 'Eve',
  });

  const sendCalls = [];
  const autoReply = new AutoReplyService({
    settingService: {
      async getValue(key, fallback) {
        if (key === 'AUTO_REPLY_ENABLED') return false;   // ← disabled
        return fallback;
      },
    },
    templateService: { render(b) { return b; } },
    autoReplyLogRepo: { async hasAutoReplied() { return false; }, async record() {} },
    outgoingMessageService: {
      async sendText(input) { sendCalls.push(input); return { id: 1 }; },
    },
  });

  const result = await autoReply.maybeReply({ conversation, contact });
  assert.equal(result.replied, false, 'S09: replied must be false');
  assert.equal(result.reason, 'disabled', 'S09: reason = disabled');
  assert.equal(sendCalls.length, 0, 'S09: no outgoing message sent');
});

// ═══════════════════════════════════════════════════════════════════════════
// S10 — Auto-reply once-per-contact: second inbound does NOT trigger reply
// ═══════════════════════════════════════════════════════════════════════════
test('S10: AUTO_REPLY_ONCE_PER_CONTACT=true → second message gets no reply', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });
  const { contact, conversation } = await resolver.resolveCustomerAndLead({
    phone: '12223330009', name: 'Frank',
  });

  let alreadyReplied = false;
  const sendCalls = [];

  const autoReply = new AutoReplyService({
    settingService: {
      async getValue(key, fallback) {
        if (key === 'AUTO_REPLY_ENABLED') return true;
        if (key === 'AUTO_REPLY_BODY') return 'Welcome!';
        if (key === 'AUTO_REPLY_SKIP_ASSIGNED') return false;
        if (key === 'AUTO_REPLY_ONCE_PER_CONTACT') return true;
        return fallback;
      },
    },
    templateService: { render(b) { return b; } },
    autoReplyLogRepo: {
      async hasAutoReplied() { return alreadyReplied; },
      async record() { alreadyReplied = true; },
    },
    outgoingMessageService: {
      async sendText(input) {
        sendCalls.push(input);
        return { id: sendCalls.length };
      },
    },
  });

  const first = await autoReply.maybeReply({ conversation, contact });
  assert.equal(first.replied, true, 'S10: first reply fires');

  const second = await autoReply.maybeReply({ conversation, contact });
  assert.equal(second.replied, false, 'S10: second message must NOT get a reply');
  assert.equal(second.reason, 'already-replied', 'S10: reason = already-replied');
  assert.equal(sendCalls.length, 1, 'S10: exactly one message sent total');
});

// ═══════════════════════════════════════════════════════════════════════════
// S11 — Auto-reply skips assigned conversations
// ═══════════════════════════════════════════════════════════════════════════
test('S11: AUTO_REPLY_SKIP_ASSIGNED=true and conversation is assigned → no reply', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });
  const { contact, conversation } = await resolver.resolveCustomerAndLead({
    phone: '12223330010', name: 'Grace',
  });
  conversation.assignedAgentId = 7; // operator owns this chat

  const sendCalls = [];
  const autoReply = new AutoReplyService({
    settingService: {
      async getValue(key, fallback) {
        if (key === 'AUTO_REPLY_ENABLED') return true;
        if (key === 'AUTO_REPLY_SKIP_ASSIGNED') return true;  // ← skip assigned
        return fallback;
      },
    },
    templateService: { render(b) { return b; } },
    autoReplyLogRepo: { async hasAutoReplied() { return false; }, async record() {} },
    outgoingMessageService: {
      async sendText(input) { sendCalls.push(input); return { id: 1 }; },
    },
  });

  const result = await autoReply.maybeReply({ conversation, contact });
  assert.equal(result.replied, false, 'S11: replied must be false');
  assert.equal(result.reason, 'assigned', 'S11: reason = assigned');
  assert.equal(sendCalls.length, 0, 'S11: no outgoing message sent');
});

// ═══════════════════════════════════════════════════════════════════════════
// S12 — Auto-reply uses fallback default template when no BODY setting
// ═══════════════════════════════════════════════════════════════════════════
test('S12: no AUTO_REPLY_BODY → falls back to default template, reply sent', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });
  const { contact, conversation } = await resolver.resolveCustomerAndLead({
    phone: '12223330011', name: 'Heidi',
  });

  const sendCalls = [];
  const autoReply = new AutoReplyService({
    settingService: {
      async getValue(key, fallback) {
        if (key === 'AUTO_REPLY_ENABLED') return true;
        if (key === 'AUTO_REPLY_BODY') return null;           // no literal body
        if (key === 'AUTO_REPLY_TEMPLATE_ID') return null;    // no explicit template
        if (key === 'AUTO_REPLY_SKIP_ASSIGNED') return false;
        if (key === 'AUTO_REPLY_ONCE_PER_CONTACT') return false;
        return fallback;
      },
    },
    templateService: {
      async findDefault() {
        return { id: 99, body: 'Hi {{name}}, thanks for reaching out!', isActive: true };
      },
      render(body, vars) {
        return body.replace(/\{\{name\}\}/g, vars.name || 'there');
      },
      async incrementUsage() {},
    },
    autoReplyLogRepo: { async hasAutoReplied() { return false; }, async record() {} },
    outgoingMessageService: {
      async sendText(input) { sendCalls.push(input); return { id: 99 }; },
    },
  });

  const result = await autoReply.maybeReply({ conversation, contact });
  assert.equal(result.replied, true, 'S12: should reply via fallback template');
  assert.equal(result.templateId, 99, 'S12: templateId matches the default template');
  assert.match(result.body, /Heidi/, 'S12: name is rendered in the body');
  assert.equal(sendCalls.length, 1, 'S12: one message sent');
});

// ═══════════════════════════════════════════════════════════════════════════
// S13 — Multiple different customers: zero cross-contamination
// ═══════════════════════════════════════════════════════════════════════════
test('S13: 5 different phone numbers → 5 distinct contacts and 5 distinct deals', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  const phones = [
    '12223330020', '12223330021', '12223330022', '12223330023', '12223330024',
  ];

  const results = await Promise.all(
    phones.map((phone, i) =>
      resolver.resolveCustomerAndLead({ phone, name: `Customer ${i + 1}` })
    )
  );

  assert.equal(svc._contacts.size, 5, 'S13: exactly 5 contacts, no cross-contamination');
  assert.equal(svc._deals.size, 5, 'S13: exactly 5 deals, one per customer');

  // All deal IDs are unique
  const dealIds = results.map(r => r.deal.ID);
  const unique = new Set(dealIds);
  assert.equal(unique.size, 5, 'S13: all 5 deal IDs are unique');

  // All contact IDs are unique
  const contactIds = results.map(r => r.contact.id);
  const uniqueContacts = new Set(contactIds);
  assert.equal(uniqueContacts.size, 5, 'S13: all 5 contact IDs are unique');
});

// ═══════════════════════════════════════════════════════════════════════════
// S14 — resolveCustomer vs resolveCustomerAndLead: deal only in the latter
// ═══════════════════════════════════════════════════════════════════════════
test('S14: resolveCustomer skips deal; resolveCustomerAndLead creates it', async () => {
  const svc = buildFakeConversationService();
  const resolver = new CustomerResolverService({ conversationService: svc });

  // resolveCustomer: must NOT call ensureOpenDeal
  await resolver.resolveCustomer({ phone: '12223330025', name: 'Ivan' });
  assert.equal(svc.calls.ensureOpenDeal, 0, 'S14: resolveCustomer must NOT call ensureOpenDeal');
  assert.equal(svc._contacts.size, 1, 'S14: contact created');
  assert.equal(svc._deals.size, 0, 'S14: no deal created by resolveCustomer');

  // resolveCustomerAndLead on the SAME phone: creates deal (contact is reused)
  const { deal, contactCreated, dealCreated } = await resolver.resolveCustomerAndLead({
    phone: '12223330025', name: 'Ivan',
  });

  assert.equal(contactCreated, false, 'S14: contact was NOT re-created');
  assert.equal(dealCreated, true, 'S14: deal was newly created');
  assert.ok(deal, 'S14: deal object returned');
  assert.equal(svc._deals.size, 1, 'S14: exactly one deal now exists');
  assert.equal(svc._contacts.size, 1, 'S14: still only one contact');
});

// ═══════════════════════════════════════════════════════════════════════════
// S15 — sendMedia outbound to new number: contact + deal created, type set
// ═══════════════════════════════════════════════════════════════════════════
test('S15: sendMedia to new number → contact created, deal created, type=IMAGE', async () => {
  const svc = buildFakeConversationService();
  const deps = buildOutgoingDeps(svc);
  const service = new OutgoingMessageService(deps);

  const result = await service.sendMedia({
    to: '12223330030',
    type: 'image',
    link: 'https://example.com/promo.jpg',
    caption: 'Check out our new product!',
  });

  assert.equal(svc._contacts.size, 1, 'S15: contact created for media recipient');
  assert.equal(svc._deals.size, 1, 'S15: deal created for media recipient');
  assert.equal(result.type, 'IMAGE', 'S15: message type is IMAGE');
  assert.equal(result.status, 'SENT', 'S15: media message sent successfully');
  assert.equal(result.mediaUrl, 'https://example.com/promo.jpg', 'S15: mediaUrl preserved');
});
