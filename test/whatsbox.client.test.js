const { test } = require('node:test');
const assert = require('node:assert');
const { mapAxiosError, isTransient } = require('../src/services/whatsbox/client');
const { WhatsBoxApiError } = require('../src/services/whatsbox/whatsbox.error');

test('mapAxiosError: HTTP 429 maps with status preserved', () => {
  const err = mapAxiosError({
    response: { status: 429, data: { message: 'rate limited' } },
  });
  assert.ok(err instanceof WhatsBoxApiError);
  assert.strictEqual(err.statusCode, 429);
  assert.strictEqual(err.message, 'rate limited');
});

test('mapAxiosError: network failure maps to NETWORK_ERROR', () => {
  const err = mapAxiosError({ request: {}, code: 'ECONNREFUSED', message: 'refused' });
  assert.ok(err instanceof WhatsBoxApiError);
  assert.strictEqual(err.code, 'NETWORK_ERROR');
});

test('mapAxiosError: generic error maps to UNKNOWN', () => {
  const err = mapAxiosError(new Error('boom'));
  assert.ok(err instanceof WhatsBoxApiError);
  assert.strictEqual(err.code, 'UNKNOWN');
});

test('isTransient: 429/5xx/network yes, 4xx no', () => {
  assert.strictEqual(isTransient(new WhatsBoxApiError('x', 'HTTP_429', 429)), true);
  assert.strictEqual(isTransient(new WhatsBoxApiError('x', 'HTTP_500', 500)), true);
  assert.strictEqual(isTransient(new WhatsBoxApiError('x', 'NETWORK_ERROR', 502)), true);
  assert.strictEqual(isTransient(new WhatsBoxApiError('x', 'HTTP_400', 400)), false);
});
