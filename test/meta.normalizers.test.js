const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeWebhook } = require('../src/webhooks/meta/normalizers');
const { MESSAGE_TYPE } = require('../src/constants');

test('Meta envelope: message and status carry provider META', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15550000000' },
      contacts: [{ profile: { name: 'John' }, wa_id: '15551234567' }],
      messages: [{ from: '15551234567', id: 'wamid.1', timestamp: '1712995245', type: 'text', text: { body: 'Hi' } }],
      statuses: [{ id: 'wamid.2', status: 'delivered', timestamp: '1712995246' }],
    } }] }],
  });

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].canonical.provider, 'META');
  assert.strictEqual(events[0].canonical.body, 'Hi');
  assert.strictEqual(events[1].canonical.provider, 'META');
  assert.strictEqual(events[1].canonical.status, 'DELIVERED');
});

test('Meta envelope: phone number id is carried into the canonical message', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15550000000', phone_number_id: '1077' },
      contacts: [],
      messages: [{ from: '15551234567', id: 'wamid.p1', timestamp: 1, type: 'text', text: { body: 'Hi' } }],
      statuses: [{ id: 'wamid.p2', status: 'delivered', timestamp: 1 }],
    } }] }],
  });

  assert.strictEqual(events[0].canonical.provider, 'META');
  assert.strictEqual(events[0].canonical.channelId, '15550000000');
  assert.strictEqual(events[0].canonical.phoneNumberId, '1077');
  assert.strictEqual(events[1].canonical.phoneNumberId, '1077');
});

test('Meta envelope: template message maps to TEXT with template name', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{ from: '15551234567', id: 'wamid.t1', timestamp: 1, type: 'template', template: { name: 'hello_world' } }],
    } }] }],
  });

  const e = events[0].canonical;
  assert.strictEqual(e.type, MESSAGE_TYPE.TEXT);
  assert.strictEqual(e.body, 'Template: hello_world');
});

test('Meta envelope: interactive button_reply maps to TEXT with the chosen title', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.b1', timestamp: 1, type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes, call me' } },
      }],
    } }] }],
  });

  const e = events[0].canonical;
  assert.strictEqual(e.type, MESSAGE_TYPE.TEXT);
  assert.strictEqual(e.body, 'Yes, call me');
});

test('Meta envelope: interactive list_reply maps to TEXT', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{
        from: '15551234567', id: 'wamid.l1', timestamp: 1, type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'opt1', title: 'Pricing' } },
      }],
    } }] }],
  });

  assert.strictEqual(events[0].canonical.type, MESSAGE_TYPE.TEXT);
  assert.strictEqual(events[0].canonical.body, 'Pricing');
});

test('Meta envelope: legacy button maps to TEXT', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{ from: '15551234567', id: 'wamid.bt1', timestamp: 1, type: 'button', button: { text: 'START', payload: 'start' } }],
    } }] }],
  });

  assert.strictEqual(events[0].canonical.type, MESSAGE_TYPE.TEXT);
  assert.strictEqual(events[0].canonical.body, 'START');
});

test('Meta envelope: PDF and voice detection preserved', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [
        { from: '15551234567', id: 'wamid.p', timestamp: 1, type: 'document', document: { mime_type: 'application/pdf', file_name: 'inv.pdf' } },
        { from: '15551234567', id: 'wamid.v', timestamp: 1, type: 'audio', audio: { mime_type: 'audio/ogg; codecs=opus' } },
      ],
    } }] }],
  });

  assert.strictEqual(events[0].canonical.type, MESSAGE_TYPE.PDF);
  assert.strictEqual(events[1].canonical.type, MESSAGE_TYPE.VOICE);
});

test('Meta envelope: media id is kept when no link is present', () => {
  const { events } = normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: {}, contacts: [],
      messages: [{ from: '15551234567', id: 'wamid.i', timestamp: 1, type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
    } }] }],
  });

  assert.strictEqual(events[0].canonical.mediaUrl, 'media-1');
});

test('non-Meta payload returns empty events', () => {
  assert.deepStrictEqual(normalizeWebhook(null).events, []);
  assert.deepStrictEqual(normalizeWebhook({ foo: 'bar' }).events, []);
  assert.strictEqual(normalizeWebhook({ foo: 'bar' }).error, 'Expected Meta Cloud API envelope (entry array)');
});
