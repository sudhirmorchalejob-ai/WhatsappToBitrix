const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMessageController } = require('../src/controllers/message.controller');
const { createContactController } = require('../src/controllers/contact.controller');
const { createConversationController } = require('../src/controllers/conversation.controller');
const { createTemplateController } = require('../src/controllers/template.controller');

// ------------------------------------------------------------------ helpers

function mockRes() {
  const res = {};
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(body) {
    res.body = body;
    return res;
  };
  return res;
}

function mockReq(partial = {}) {
  return { body: {}, query: {}, params: {}, ...partial };
}

const messageRow = {
  id: 100,
  conversationId: 10,
  contactId: 1,
  direction: 'OUTGOING',
  type: 'TEXT',
  body: 'hi',
  status: 'SENT',
};

// ------------------------------------------------------------------ message

test('sendText returns 201 with the persisted message row', async () => {
  const service = { sendText: async () => messageRow };
  const controller = createMessageController({ service, messageRepo: {} });
  const res = mockRes();

  await controller.sendText(mockReq({ body: { to: '15551234567', body: 'hi' } }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, 100);
});

test('sendMedia returns 201 with the persisted media row', async () => {
  const service = { sendMedia: async () => ({ ...messageRow, id: 101, type: 'IMAGE' }) };
  const controller = createMessageController({ service, messageRepo: {} });
  const res = mockRes();

  await controller.sendMedia(
    mockReq({ body: { to: '15551234567', type: 'image', link: 'https://cdn.example.com/a.jpg' } }),
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.type, 'IMAGE');
});

test('listMessages returns the envelope with pagination meta', async () => {
  const messageRepo = {
    list: async () => ({ items: [messageRow], total: 35 }),
  };
  const controller = createMessageController({ service: {}, messageRepo });
  const res = mockRes();

  await controller.listMessages(mockReq({ query: { limit: 10, offset: 0 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.deepEqual(res.body.meta, {
    total: 35,
    limit: 10,
    offset: 0,
    page: 1,
    pages: 4,
    hasMore: true,
  });
});

test('getMessage returns the row when found', async () => {
  const messageRepo = { findById: async () => messageRow };
  const controller = createMessageController({ service: {}, messageRepo });
  const res = mockRes();

  await controller.getMessage(mockReq({ params: { id: 100 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.id, 100);
});

test('getMessage throws a 404 AppError when the row is missing', async () => {
  const messageRepo = { findById: async () => null };
  const controller = createMessageController({ service: {}, messageRepo });
  const res = mockRes();

  await assert.rejects(
    () => controller.getMessage(mockReq({ params: { id: 999 } }), res),
    (err) => err.code === 'MESSAGE_NOT_FOUND' && err.statusCode === 404
  );
});

// ------------------------------------------------------------------ contact

test('listContacts returns the envelope with pagination meta', async () => {
  const contactRepo = { list: async () => ({ items: [{ id: 1 }], total: 1 }) };
  const controller = createContactController({ contactRepo });
  const res = mockRes();

  await controller.listContacts(mockReq({ query: {} }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.meta.total, 1);
});

test('getContact throws 404 when missing', async () => {
  const contactRepo = { findById: async () => null };
  const controller = createContactController({ contactRepo });
  const res = mockRes();

  await assert.rejects(
    () => controller.getContact(mockReq({ params: { id: 5 } }), res),
    (err) => err.code === 'CONTACT_NOT_FOUND'
  );
});

// ------------------------------------------------------------ conversation

test('listConversations returns the envelope with pagination meta', async () => {
  const conversationRepo = { list: async () => ({ items: [{ id: 10 }], total: 3 }) };
  const controller = createConversationController({ conversationRepo });
  const res = mockRes();

  await controller.listConversations(mockReq({ query: { limit: 25, offset: 0 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.meta.limit, 25);
  assert.equal(res.body.meta.hasMore, false);
});

test('getConversation throws 404 when missing', async () => {
  const conversationRepo = { findById: async () => null };
  const controller = createConversationController({ conversationRepo });
  const res = mockRes();

  await assert.rejects(
    () => controller.getConversation(mockReq({ params: { id: 999 } }), res),
    (err) => err.code === 'CONVERSATION_NOT_FOUND'
  );
});

test('assignConversation resolves byUserId and returns the assignment summary', async () => {
  const routingService = {
    assignByUser: async ({ conversationId, byUserId }) => ({
      agent: { id: 7, bitrix24UserId: 701 },
      assignment: { conversationId, agentId: 7 },
    }),
  };
  const controller = createConversationController({ routingService });
  const res = mockRes();

  await controller.assignConversation(
    mockReq({ params: { id: 10 }, body: { byUserId: 701 } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.conversationId, 10);
  assert.equal(res.body.data.agentId, 7);
  assert.equal(res.body.data.byUserId, 701);
});

test('unassignConversation clears the assignment', async () => {
  const routingService = {
    unassign: async ({ conversationId, byUserId }) => ({ conversationId, unassigned: true }),
  };
  const controller = createConversationController({ routingService });
  const res = mockRes();

  await controller.unassignConversation(mockReq({ params: { id: 10 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.unassigned, true);
});

// ---------------------------------------------------------------- template

const templateRow = {
  id: 1,
  name: 'Welcome',
  body: 'Hi {{firstName}}!',
  category: 'greeting',
  isActive: true,
  isDefault: false,
  usageCount: 0,
};

test('createTemplate returns 201 with the persisted row', async () => {
  const templateService = { create: async () => templateRow };
  const controller = createTemplateController({ templateService });
  const res = mockRes();

  await controller.createTemplate(mockReq({ body: { name: 'Welcome', body: 'Hi {{firstName}}!' } }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, 1);
});

test('listTemplates returns the envelope with pagination meta', async () => {
  const templateService = {
    list: async () => ({ items: [templateRow], total: 25 }),
  };
  const controller = createTemplateController({ templateService });
  const res = mockRes();

  await controller.listTemplates(mockReq({ query: { limit: 10, offset: 0 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.meta.total, 25);
});

test('getTemplate returns the row when found', async () => {
  const templateService = { get: async () => templateRow };
  const controller = createTemplateController({ templateService });
  const res = mockRes();

  await controller.getTemplate(mockReq({ params: { id: 1 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.name, 'Welcome');
});

test('updateTemplate returns the updated row', async () => {
  const templateService = {
    update: async (id, data) => ({ ...templateRow, id, ...data }),
  };
  const controller = createTemplateController({ templateService });
  const res = mockRes();

  await controller.updateTemplate(mockReq({ params: { id: 1 }, body: { isDefault: true } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.isDefault, true);
});

test('deleteTemplate returns a deleted summary', async () => {
  const templateService = { delete: async () => true };
  const controller = createTemplateController({ templateService });
  const res = mockRes();

  await controller.deleteTemplate(mockReq({ params: { id: 1 } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { deleted: true, id: 1 });
});
