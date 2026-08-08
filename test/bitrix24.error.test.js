const { test } = require('node:test');
const assert = require('node:assert');
const { Bitrix24ApiError } = require('../src/services/bitrix24/bitrix24.error');

test('Bitrix24ApiError defaults', () => {
  const err = new Bitrix24ApiError('boom');
  assert.strictEqual(err.name, 'Bitrix24ApiError');
  assert.strictEqual(err.code, 'UNKNOWN');
  assert.strictEqual(err.statusCode, 502);
  assert.strictEqual(err.isOperational, true);
});

test('Bitrix24ApiError carries code and details', () => {
  const err = new Bitrix24ApiError('too fast', 'QUERY_LIMIT_EXCEEDED', 502, { meta: 1 });
  assert.strictEqual(err.code, 'QUERY_LIMIT_EXCEEDED');
  assert.deepStrictEqual(err.details, { meta: 1 });
});

test('Bitrix24ApiError is instanceof Error', () => {
  const err = new Bitrix24ApiError('x', 'Y');
  assert.ok(err instanceof Error);
});
