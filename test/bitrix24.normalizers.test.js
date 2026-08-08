const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBitrix24Webhook } = require('../src/webhooks/bitrix24/normalizers');

function operatorEvent(overrides = {}) {
  return {
    event: 'ONIMCONNECTORMESSAGEADD',
    ts: 1773759161,
    data: {
      CONNECTOR: 'myconnector',
      LINE: 107,
      MESSAGES: [
        {
          im: { chat_id: 1807, message_id: 86497 },
          message: { user_id: 27, text: 'Hello from operator' },
          chat: { id: 'channel-123' },
        },
      ],
    },
    auth: { member_id: 'm1', application_token: 'apptok' },
    ...overrides,
  };
}

test('normalizes ONIMCONNECTORMESSAGEADD into an operatorMessage event', () => {
  const { events, error } = normalizeBitrix24Webhook(operatorEvent());
  assert.equal(error, null);
  assert.equal(events.length, 1);
  const { kind, eventName, canonical } = events[0];
  assert.equal(kind, 'operatorMessage');
  assert.equal(eventName, 'ONIMCONNECTORMESSAGEADD');
  assert.equal(canonical.event, 'operatorMessage');
  assert.equal(canonical.provider, 'BITRIX24');
  assert.equal(canonical.memberId, 'm1');
  assert.equal(canonical.connector, 'myconnector');
  assert.equal(canonical.line, 107);
  assert.equal(canonical.b24ChatId, 1807);
  assert.equal(canonical.b24MessageId, 86497);
  assert.equal(canonical.userId, 27);
  assert.equal(canonical.text, 'Hello from operator');
  assert.equal(canonical.externalChatId, 'channel-123');
  assert.equal(canonical.timestamp.getTime(), 1773759161 * 1000);
});

test('expands one canonical event per message in MESSAGES', () => {
  const payload = operatorEvent({
    data: {
      CONNECTOR: 'c1',
      LINE: 5,
      MESSAGES: [
        { im: { chat_id: 1, message_id: 11 }, message: { user_id: 2, text: 'a' }, chat: { id: 'x1' } },
        { im: { chat_id: 1, message_id: 12 }, message: { user_id: 3, text: 'b' }, chat: { id: 'x1' } },
      ],
    },
  });
  const { events } = normalizeBitrix24Webhook(payload);
  assert.equal(events.length, 2);
  assert.equal(events[0].canonical.b24MessageId, 11);
  assert.equal(events[1].canonical.b24MessageId, 12);
});

test('tolerates missing optional fields with null fallbacks', () => {
  const payload = operatorEvent({
    data: { MESSAGES: [{ im: {}, message: {}, chat: {} }] },
  });
  const { events } = normalizeBitrix24Webhook(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0].canonical.externalChatId, null);
  assert.equal(events[0].canonical.userId, null);
  assert.equal(events[0].canonical.text, null);
});

test('ONIMCONNECTORMESSAGEUPDATE normalizes to an update event', () => {
  const payload = operatorEvent({ event: 'ONIMCONNECTORMESSAGEUPDATE' });
  const { events } = normalizeBitrix24Webhook(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'operatorMessageUpdate');
  assert.equal(events[0].canonical.event, 'operatorMessageUpdate');
});

test('unknown events pass through as an unhandled event', () => {
  const { events } = normalizeBitrix24Webhook({ event: 'ONAPPINSTALL', auth: { member_id: 'm1' } });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'other');
  assert.equal(events[0].canonical.event, 'other');
  assert.equal(events[0].eventName, 'ONAPPINSTALL');
});

test('extracts attachments from message.files into canonical media fields', () => {
  const payload = operatorEvent({
    data: {
      CONNECTOR: 'myconnector',
      LINE: 107,
      MESSAGES: [
        {
          im: { chat_id: 1807, message_id: 86497 },
          message: {
            user_id: 27,
            text: 'see the file',
            files: [
              { name: 'photo.jpg', link: 'https://files.example/photo.jpg', type: 'image/jpeg', size: '12345' },
              { name: 'scan.pdf', link: 'https://files.example/scan.pdf', type: 'application/pdf', size: 999 },
            ],
          },
          chat: { id: 'channel-123' },
        },
      ],
    },
  });
  const { events } = normalizeBitrix24Webhook(payload);
  const canonical = events[0].canonical;

  assert.equal(canonical.text, 'see the file');
  assert.deepEqual(canonical.files, [
    { name: 'photo.jpg', link: 'https://files.example/photo.jpg', path: null, mimeType: 'image/jpeg', size: 12345 },
    { name: 'scan.pdf', link: 'https://files.example/scan.pdf', path: null, mimeType: 'application/pdf', size: 999 },
  ]);
  assert.deepEqual(canonical.file, canonical.files[0]);
});

test('drops file entries without a link or path and leaves file null', () => {
  const payload = operatorEvent({
    data: {
      MESSAGES: [
        {
          im: { chat_id: 1, message_id: 2 },
          message: { user_id: 3, files: [{ name: 'broken.pdf' }, null, 'junk'] },
          chat: { id: 'c1' },
        },
      ],
    },
  });
  const { events } = normalizeBitrix24Webhook(payload);
  assert.equal(events[0].canonical.files, null);
  assert.equal(events[0].canonical.file, null);
});

test('non-object payload returns an error and no events', () => {
  assert.deepEqual(normalizeBitrix24Webhook(null).events, []);
  assert.match(normalizeBitrix24Webhook('x').error, /Payload is not an object/);
});
