const { test } = require('node:test');
const assert = require('node:assert');
const { mapAxiosError, isTransient } = require('../src/services/meta/client');
const { MetaApiError } = require('../src/services/meta/meta.error');

test('mapAxiosError: Meta error body maps message + code + status', () => {
  const err = mapAxiosError({
    response: { status: 400, data: { error: { message: 'Bad message', code: 100 } } },
  });
  assert.ok(err instanceof MetaApiError);
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, '100');
  assert.strictEqual(err.message, 'Bad message');
});

test('mapAxiosError: HTTP 429 maps with status preserved', () => {
  const err = mapAxiosError({ response: { status: 429, data: { error: { message: 'rate limited' } } } });
  assert.ok(err instanceof MetaApiError);
  assert.strictEqual(err.statusCode, 429);
  assert.ok(err.code);
});

test('mapAxiosError: network failure maps to NETWORK_ERROR', () => {
  const err = mapAxiosError({ request: {}, code: 'ECONNREFUSED', message: 'refused' });
  assert.ok(err instanceof MetaApiError);
  assert.strictEqual(err.code, 'NETWORK_ERROR');
});

test('mapAxiosError: generic error maps to UNKNOWN', () => {
  const err = mapAxiosError(new Error('boom'));
  assert.ok(err instanceof MetaApiError);
  assert.strictEqual(err.code, 'UNKNOWN');
});

test('isTransient: 429/5xx/network/temp-block yes, 4xx no', () => {
  assert.strictEqual(isTransient(new MetaApiError('x', 'HTTP_429', 429)), true);
  assert.strictEqual(isTransient(new MetaApiError('x', 'HTTP_500', 500)), true);
  assert.strictEqual(isTransient(new MetaApiError('x', 'NETWORK_ERROR', 502)), true);
  assert.strictEqual(isTransient(new MetaApiError('x', '131056', 403)), true);
  assert.strictEqual(isTransient(new MetaApiError('x', 'HTTP_400', 400)), false);
});

test('MetaClient constructor throws NOT_CONFIGURED without access token', () => {
  assert.throws(
    () => new (require('../src/services/meta/client').MetaClient)({ accessToken: '' }),
    (err) => err.code === 'NOT_CONFIGURED' && err.statusCode === 503
  );
});
