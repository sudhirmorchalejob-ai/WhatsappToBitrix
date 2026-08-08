const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoReplyService } = require('../src/services/autoReply.service');

const CONTACT = { id: 5, whatsappPhone: '+15551234567', name: 'John Doe', firstName: 'John', lastName: 'Doe' };
const CONVERSATION = { id: 10, assignedAgentId: null };

function createFakes({ settings = {}, templates = [], hasAutoReplied = false } = {}) {
  const calls = { sendText: [], record: [], incrementUsage: [], getValue: [], hasAutoReplied: [] };

  const settingService = {
    getValue: async (key, fallback) => {
      calls.getValue.push({ key, fallback });
      return key in settings ? settings[key] : fallback;
    },
  };

  const templateService = {
    get: async (id) => templates.find((t) => t.id === id) || null,
    findDefault: async () => templates.find((t) => t.isDefault && t.isActive) || null,
    render: (body, vars) =>
      String(body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))),
    incrementUsage: async (id) => {
      calls.incrementUsage.push(id);
    },
  };

  const outgoingMessageService = {
    sendText: async (input) => {
      calls.sendText.push(input);
      return { id: 500, ...input };
    },
  };

  const autoReplyLogRepo = {
    hasAutoReplied: async (q) => {
      calls.hasAutoReplied.push(q);
      return hasAutoReplied;
    },
    record: async (data) => {
      calls.record.push(data);
      return { id: 1, ...data };
    },
  };

  const service = new AutoReplyService({ settingService, templateService, outgoingMessageService, autoReplyLogRepo });
  return { service, calls };
}

test('does not reply when auto-reply is disabled', async () => {
  const { service, calls } = createFakes({ settings: { AUTO_REPLY_ENABLED: false } });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.deepEqual(result, { replied: false, reason: 'disabled' });
  assert.equal(calls.sendText.length, 0);
});

test('skips when an operator owns the chat (default skipAssigned)', async () => {
  const { service, calls } = createFakes({ settings: { AUTO_REPLY_ENABLED: true } });
  const result = await service.maybeReply({ conversation: { id: 10, assignedAgentId: 7 }, contact: CONTACT });
  assert.equal(result.reason, 'assigned');
  assert.equal(calls.sendText.length, 0);
});

test('replies to an assigned chat when skipAssigned is disabled', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true, AUTO_REPLY_SKIP_ASSIGNED: false, AUTO_REPLY_BODY: 'One moment please' },
  });
  const result = await service.maybeReply({ conversation: { id: 10, assignedAgentId: 7 }, contact: CONTACT });
  assert.equal(result.replied, true);
  assert.equal(calls.sendText[0].to, '+15551234567');
});

test('suppresses repeats for the same contact (once per contact default)', async () => {
  const { service, calls } = createFakes({ settings: { AUTO_REPLY_ENABLED: true }, hasAutoReplied: true });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(result.reason, 'already-replied');
  assert.deepEqual(calls.hasAutoReplied[0], {
    contactId: 5,
    conversationId: 10,
    oncePerContact: true,
  });
  assert.equal(calls.sendText.length, 0);
});

test('checks per-conversation when oncePerContact is disabled', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true, AUTO_REPLY_ONCE_PER_CONTACT: false },
    hasAutoReplied: false,
  });
  await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(calls.hasAutoReplied[0].oncePerContact, false);
  assert.equal(calls.hasAutoReplied[0].conversationId, 10);
});

test('literal AUTO_REPLY_BODY wins and is rendered', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true, AUTO_REPLY_BODY: 'Hi {{firstName}}, we will reply soon!' },
  });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(result.replied, true);
  assert.equal(result.templateId, null);
  assert.equal(result.body, 'Hi John, we will reply soon!');
  assert.equal(calls.sendText[0].body, 'Hi John, we will reply soon!');
});

test('uses the explicit template id and records usage', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true, AUTO_REPLY_TEMPLATE_ID: 3 },
    templates: [{ id: 3, name: 'Away', body: 'Thanks {{firstName}}!', isActive: true }],
  });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(result.replied, true);
  assert.equal(result.templateId, 3);
  assert.equal(result.body, 'Thanks John!');
  assert.deepEqual(calls.incrementUsage, [3]);
  assert.deepEqual(calls.record[0], {
    contactId: 5,
    conversationId: 10,
    messageId: 500,
    templateId: 3,
    body: 'Thanks John!',
  });
});

test('falls back to the active default template', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true },
    templates: [{ id: 7, name: 'Welcome', body: 'Hello {{name}}!', isActive: true, isDefault: true }],
  });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(result.replied, true);
  assert.equal(result.templateId, 7);
  assert.equal(result.body, 'Hello John Doe!');
  assert.deepEqual(calls.incrementUsage, [7]);
});

test('returns no-template when nothing is configured', async () => {
  const { service, calls } = createFakes({ settings: { AUTO_REPLY_ENABLED: true } });
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.deepEqual(result, { replied: false, reason: 'no-template' });
  assert.equal(calls.sendText.length, 0);
});

test('a send failure is swallowed and not recorded', async () => {
  const { service, calls } = createFakes({
    settings: { AUTO_REPLY_ENABLED: true, AUTO_REPLY_BODY: 'hi' },
  });
  service.outgoingMessageService.sendText = async () => {
    throw new Error('provider down');
  };
  const result = await service.maybeReply({ conversation: CONVERSATION, contact: CONTACT });
  assert.equal(result.replied, false);
  assert.equal(result.reason, 'send-failed');
  assert.equal(calls.record.length, 0);
});

test('no context is a safe no-op', async () => {
  const { service } = createFakes({ settings: { AUTO_REPLY_ENABLED: true } });
  const result = await service.maybeReply({ conversation: null, contact: null });
  assert.deepEqual(result, { replied: false, reason: 'no-context' });
});
