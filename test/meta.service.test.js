const { test } = require('node:test');
const assert = require('node:assert');
const { metaService } = require('../src/services/meta');

test('sendText without configuration rejects with 503 AppError', async () => {
  await assert.rejects(
    () => metaService.sendText({ to: '15551234567', body: 'hello' }),
    (err) => err.statusCode === 503 && err.code === 'META_NOT_CONFIGURED'
  );
});

test('sendText with empty body rejects with ZodError', async () => {
  await assert.rejects(
    () => metaService.sendText({ to: '15551234567', body: '' }),
    (err) => err.name === 'ZodError'
  );
});

test('sendText with invalid phone rejects', async () => {
  await assert.rejects(
    () => metaService.sendText({ to: 'ab', body: 'hello' }),
    (err) => err.name === 'ZodError'
  );
});

test('sendMedia rejects when neither link nor mediaId provided', async () => {
  await assert.rejects(
    () => metaService.sendMedia({ to: '15551234567', type: 'image' }),
    (err) => err.name === 'ZodError'
  );
});

test('sendMedia rejects unsupported media type', async () => {
  await assert.rejects(
    () => metaService.sendMedia({ to: '15551234567', type: 'gif', link: 'https://x.test/a.gif' }),
    (err) => err.name === 'ZodError'
  );
});

test('markAsRead rejects without message id', async () => {
  await assert.rejects(() => metaService.markAsRead(''), (err) => err.code === 'MESSAGE_ID_REQUIRED');
});

test('_extractResult returns the wamid from the Meta send envelope', () => {
  assert.strictEqual(
    metaService._extractResult({
      messaging_product: 'whatsapp',
      contacts: [{ input: '+15551234567', wa_id: '15551234567' }],
      messages: [{ id: 'wamid.abc123' }],
    }).wamid,
    'wamid.abc123'
  );
  assert.strictEqual(metaService._extractResult({ messages: [] }).wamid, null);
  assert.strictEqual(metaService._extractResult({ hello: 'x' }).wamid, null);
  assert.strictEqual(metaService._extractResult(null).wamid, null);
});

test('_buildContactCard builds the Meta contacts payload', () => {
  const card = metaService._buildContactCard({
    name: 'Jane Doe',
    firstName: 'Jane',
    phones: ['+15551234567'],
    emails: ['jane@example.com'],
  });
  assert.strictEqual(card.name.formatted_name, 'Jane Doe');
  assert.strictEqual(card.name.first_name, 'Jane');
  assert.strictEqual(card.phones[0].wa_id, '15551234567');
  assert.strictEqual(card.phones[0].type, 'CELL');
  assert.strictEqual(card.emails[0].email, 'jane@example.com');
});

test('testConnection without configuration rejects', async () => {
  await assert.rejects(() => metaService.testConnection(), (err) => err.statusCode === 503);
});
