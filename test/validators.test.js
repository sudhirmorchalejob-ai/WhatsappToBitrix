const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sendTextSchema,
  sendMediaSchema,
  listMessagesQuerySchema,
  listContactsQuerySchema,
  listConversationsQuerySchema,
  setSettingSchema,
} = require('../src/validators');
const { validate } = require('../src/validators/common');

// --------------------------------------------------------------- helpers

function parseSafe(schema, input) {
  return schema.safeParse(input);
}

function makeReqRes(initial) {
  const req = { body: { ...(initial || {}) }, query: {}, params: {}, get: () => null };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

// ------------------------------------------------------------- send text

test('sendTextSchema accepts a minimal valid payload', () => {
  const parsed = parseSafe(sendTextSchema, { to: '15551234567', body: 'Hello' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.to, '15551234567');
});

test('sendTextSchema rejects an empty body', () => {
  const parsed = parseSafe(sendTextSchema, { to: '15551234567', body: '' });
  assert.equal(parsed.success, false);
});

test('sendTextSchema rejects a too-short phone', () => {
  const parsed = parseSafe(sendTextSchema, { to: '12', body: 'hi' });
  assert.equal(parsed.success, false);
});

test('sendTextSchema coerces numeric conversationId and dealId', () => {
  const parsed = parseSafe(sendTextSchema, { to: '15551234567', body: 'hi', conversationId: '7', dealId: '9' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.conversationId, 7);
  assert.equal(parsed.data.dealId, 9);
});

// ------------------------------------------------------------ send media

test('sendMediaSchema accepts image with a public link', () => {
  const parsed = parseSafe(sendMediaSchema, {
    to: '15551234567',
    type: 'image',
    link: 'https://cdn.example.com/a.jpg',
  });
  assert.equal(parsed.success, true);
});

test('sendMediaSchema rejects an invalid media type', () => {
  const parsed = parseSafe(sendMediaSchema, { to: '15551234567', type: 'gif', link: 'https://cdn.example.com/a.gif' });
  assert.equal(parsed.success, false);
});

test('sendMediaSchema rejects a non-URL link', () => {
  const parsed = parseSafe(sendMediaSchema, { to: '15551234567', type: 'document', link: 'not-a-url' });
  assert.equal(parsed.success, false);
});

// -------------------------------------------------- message list query

test('listMessagesQuerySchema coerces query strings to numbers', () => {
  const parsed = parseSafe(listMessagesQuerySchema, {
    conversationId: '7',
    contactId: '3',
    limit: '25',
    offset: '10',
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.conversationId, 7);
  assert.equal(parsed.data.contactId, 3);
  assert.equal(parsed.data.limit, 25);
  assert.equal(parsed.data.offset, 10);
});

test('listMessagesQuerySchema parses mediaOnly booleans correctly', () => {
  assert.equal(parseSafe(listMessagesQuerySchema, { mediaOnly: 'true' }).data.mediaOnly, true);
  assert.equal(parseSafe(listMessagesQuerySchema, { mediaOnly: 'false' }).data.mediaOnly, false);
  assert.equal(parseSafe(listMessagesQuerySchema, {}).data.mediaOnly, false);
});

test('listMessagesQuerySchema applies pagination defaults', () => {
  const parsed = parseSafe(listMessagesQuerySchema, {});
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.limit, 50);
  assert.equal(parsed.data.offset, 0);
});

test('listMessagesQuerySchema rejects an unknown direction', () => {
  const parsed = parseSafe(listMessagesQuerySchema, { direction: 'SIDEWAYS' });
  assert.equal(parsed.success, false);
});

test('listMessagesQuerySchema rejects an unknown message type', () => {
  const parsed = parseSafe(listMessagesQuerySchema, { type: 'GIF' });
  assert.equal(parsed.success, false);
});

test('listMessagesQuerySchema rejects a limit above the cap', () => {
  const parsed = parseSafe(listMessagesQuerySchema, { limit: '9999' });
  assert.equal(parsed.success, false);
});

// ------------------------------------------------------- contact query

test('listContactsQuerySchema trims search and validates syncStatus', () => {
  const parsed = parseSafe(listContactsQuerySchema, { search: '  John  ', syncStatus: 'SYNCED' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.search, 'John');
  assert.equal(parsed.data.syncStatus, 'SYNCED');
});

test('listContactsQuerySchema rejects an unknown syncStatus', () => {
  const parsed = parseSafe(listContactsQuerySchema, { syncStatus: 'MAYBE' });
  assert.equal(parsed.success, false);
});

// ---------------------------------------------------- conversation query

test('listConversationsQuerySchema validates status and coerces agent id', () => {
  const parsed = parseSafe(listConversationsQuerySchema, { status: 'OPEN', assignedAgentId: '4' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.status, 'OPEN');
  assert.equal(parsed.data.assignedAgentId, 4);
});

// ----------------------------------------------------------- settings

test('setSettingSchema validates key charset', () => {
  assert.equal(parseSafe(setSettingSchema, { key: 'auto_close.hours', value: 2 }).success, true);
  assert.equal(parseSafe(setSettingSchema, { key: 'bad key!', value: 1 }).success, false);
  assert.equal(parseSafe(setSettingSchema, { key: '' }).success, false);
});

test('setSettingSchema defaults type and isSecret', () => {
  const parsed = parseSafe(setSettingSchema, { key: 'greeting', value: 'hi' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.type, 'string');
  assert.equal(parsed.data.isSecret, false);
});

test('setSettingSchema accepts arbitrary JSON values', () => {
  const parsed = parseSafe(setSettingSchema, { key: 'conf', value: { a: [1, 2, 3] } });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.value, { a: [1, 2, 3] });
});

// ------------------------------------------------------- validate mw

test('validate middleware passes a valid body through (replaced)', () => {
  const { req, res } = makeReqRes({ to: '15551234567', body: 'hi', conversationId: '3' });
  let nextCalled = false;
  validate(sendTextSchema, 'body')(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.body.conversationId, 3);
});

test('validate middleware returns structured 400 on invalid body', () => {
  const { req, res } = makeReqRes({ to: '15551234567' });
  validate(sendTextSchema, 'body')(req, res, () => {
    assert.fail('next must not be called');
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Validation failed');
  assert.ok(Array.isArray(res.body.errors));
  assert.ok(res.body.errors.some((e) => e.path === 'body'));
});

test('validate middleware validates query source when requested', () => {
  const req = { body: {}, query: { direction: 'SIDEWAYS' }, params: {}, get: () => null };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; } };
  validate(listMessagesQuerySchema, 'query')(req, res, () => assert.fail('next must not be called'));
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.errors.some((e) => e.path === 'direction'));
});
