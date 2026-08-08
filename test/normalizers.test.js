const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeWebhook } = require('../src/webhooks/whatsbox/normalizers');
const { MESSAGE_TYPE, MESSAGE_STATUS } = require('../src/constants');

test('Meta envelope: text message', () => {
  const { events } = normalizeWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: '123' },
          contacts: [{ profile: { name: 'John' }, wa_id: '15551234567' }],
          messages: [{
            from: '15551234567', id: 'wamid.1', timestamp: '1712995245', type: 'text',
            text: { body: 'Hello' },
          }],
        },
      }],
    }],
  });

  assert.strictEqual(events.length, 1);
  const e = events[0];
  assert.strictEqual(e.kind, 'message');
  assert.strictEqual(e.canonical.type, MESSAGE_TYPE.TEXT);
  assert.strictEqual(e.canonical.from, '15551234567');
  assert.strictEqual(e.canonical.fromName, 'John');
  assert.strictEqual(e.canonical.channelId, '15550000000');
  assert.strictEqual(e.canonical.phoneNumberId, '123');
  assert.strictEqual(e.canonical.body, 'Hello');
  assert.strictEqual(e.canonical.messageId, 'wamid.1');
  assert.ok(e.canonical.timestamp instanceof Date);
});

test('Meta envelope: image with caption and media fields', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15550000000' },
      contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.2', timestamp: 1712995245, type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg', file_size: 1234, link: 'https://cdn.x/img.jpg', caption: 'Check this' },
      }],
    } }] }],
  });

  const e = events[0].canonical;
  assert.strictEqual(e.type, MESSAGE_TYPE.IMAGE);
  assert.strictEqual(e.mediaUrl, 'https://cdn.x/img.jpg');
  assert.strictEqual(e.mediaMimeType, 'image/jpeg');
  assert.strictEqual(e.mediaSize, 1234);
  assert.strictEqual(e.body, 'Check this');
  assert.strictEqual(e.caption, 'Check this');
});

test('Meta envelope: PDF document maps to PDF type', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {},
      contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.3', timestamp: 1712995245, type: 'document',
        document: { mime_type: 'application/pdf', file_name: 'invoice.pdf', link: 'https://cdn.x/invoice.pdf' },
      }],
    } }] }],
  });
  assert.strictEqual(events[0].canonical.type, MESSAGE_TYPE.PDF);
  assert.strictEqual(events[0].canonical.mediaName, 'invoice.pdf');
});

test('Meta envelope: voice note maps to VOICE', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{ from: '1', id: 'x', timestamp: 1, type: 'audio', audio: { mime_type: 'audio/ogg; codecs=opus' } }],
    } }] }],
  });
  assert.strictEqual(events[0].canonical.type, MESSAGE_TYPE.VOICE);
});

test('Meta envelope: location', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.4', timestamp: 1, type: 'location',
        location: { latitude: 12.34, longitude: 56.78, name: 'Office', address: '1 Main St' },
      }],
    } }] }],
  });
  const e = events[0].canonical;
  assert.strictEqual(e.type, MESSAGE_TYPE.LOCATION);
  assert.deepStrictEqual(e.locationData, { lat: 12.34, lng: 56.78, name: 'Office', address: '1 Main St' });
});

test('Meta envelope: contact card', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.5', timestamp: 1, type: 'contacts',
        contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+1 (555) 000-0000' }] }],
      }],
    } }] }],
  });
  const e = events[0].canonical;
  assert.strictEqual(e.type, MESSAGE_TYPE.CONTACT);
  assert.strictEqual(e.contactCard.name, 'Jane Doe');
  assert.deepStrictEqual(e.contactCard.phones, ['15550000000']);
});

test('Meta envelope: statuses array (delivered + read)', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15550000000' },
      contacts: [],
      statuses: [
        { id: 'wamid.9', status: 'delivered', timestamp: '1712995245', recipient_id: '15551234567' },
        { id: 'wamid.9', status: 'read', timestamp: '1712995300' },
      ],
    } }] }],
  });

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].canonical.status, MESSAGE_STATUS.DELIVERED);
  assert.strictEqual(events[1].canonical.status, MESSAGE_STATUS.READ);
  assert.strictEqual(events[0].canonical.messageId, 'wamid.9');
});

test('Meta envelope: failed status with error details', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      statuses: [{
        id: 'wamid.10', status: 'failed', timestamp: 1,
        errors: [{ code: 131026, title: 'Message undeliverable', message: 'Reason: blocked' }],
      }],
    } }] }],
  });
  const s = events[0].canonical;
  assert.strictEqual(s.status, MESSAGE_STATUS.FAILED);
  assert.match(s.failedReason, /blocked/);
});

test('flat envelope: text message', () => {
  const { events } = normalizeWebhook({
    event: 'incomingMessage',
    channel_id: '15550000000',
    message: { id: 'wb-1', from: '15551234567', timestamp: 1712995245, type: 'text', text: { body: 'Hi' } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].canonical.body, 'Hi');
  assert.strictEqual(events[0].canonical.channelId, '15550000000');
  assert.strictEqual(events[0].canonical.from, '15551234567');
});

test('flat envelope: status event', () => {
  const { events } = normalizeWebhook({
    event: 'messageStatus',
    channel_id: '15550000000',
    status: { message_id: 'wb-9', status: 'delivered', timestamp: 1712995245 },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].canonical.status, MESSAGE_STATUS.DELIVERED);
  assert.strictEqual(events[0].canonical.messageId, 'wb-9');
});

test('unknown payload yields empty events', () => {
  assert.deepStrictEqual(normalizeWebhook(null).events, []);
  assert.deepStrictEqual(normalizeWebhook('hello').events, []);
  assert.deepStrictEqual(normalizeWebhook({ foo: 'bar' }).events, []);
});

test('unix timestamp seconds and ISO strings both parse', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{ from: '1', id: 'x', timestamp: 1712995245, type: 'text', text: { body: 'a' } }],
    } }] }],
  });
  assert.strictEqual(events[0].canonical.timestamp.getTime(), 1712995245000);
});
