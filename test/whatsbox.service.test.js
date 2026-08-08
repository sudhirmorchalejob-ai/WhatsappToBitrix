const { test } = require('node:test');
const assert = require('node:assert');
const { whatsboxService } = require('../src/services/whatsbox');

test('sendText without configuration rejects with 503 AppError', async () => {
  await assert.rejects(
    () => whatsboxService.sendText({ to: '15551234567', body: 'hello' }),
    (err) => err.statusCode === 503 && err.code === 'WHATSBOX_NOT_CONFIGURED'
  );
});

test('sendText with invalid body rejects with ZodError', async () => {
  await assert.rejects(
    () => whatsboxService.sendText({ to: '15551234567', body: '' }),
    (err) => err.name === 'ZodError'
  );
});

test('sendMedia with unsupported type rejects with ZodError', async () => {
  await assert.rejects(
    () => whatsboxService.sendMedia({ to: '15551234567', link: 'https://x.test/a.pdf', type: 'gif' }),
    (err) => err.name === 'ZodError'
  );
});

test('sendText with invalid phone rejects', async () => {
  await assert.rejects(
    () => whatsboxService.sendText({ to: 'ab', body: 'hello' }),
    (err) => err.name === 'ZodError'
  );
});

test('_extractResult handles common response shapes', () => {
  const svc = whatsboxService;
  assert.strictEqual(svc._extractResult({ id: 'wb-1' }).whatsboxMessageId, 'wb-1');
  assert.strictEqual(svc._extractResult({ data: { id: 42 } }).whatsboxMessageId, '42');
  assert.strictEqual(svc._extractResult({ data: [{ id: 'wb-2' }] }).whatsboxMessageId, 'wb-2');
  assert.strictEqual(svc._extractResult({ result: { id: 'wb-3' } }).whatsboxMessageId, 'wb-3');
  assert.strictEqual(svc._extractResult({ result: [{ id: 'wb-4' }] }).whatsboxMessageId, 'wb-4');
  assert.strictEqual(svc._extractResult({ hello: 'x' }).whatsboxMessageId, null);
  assert.strictEqual(svc._extractResult(null).whatsboxMessageId, null);
});

test('testConnection without configuration rejects', async () => {
  await assert.rejects(() => whatsboxService.testConnection(), (err) => err.statusCode === 503);
});
