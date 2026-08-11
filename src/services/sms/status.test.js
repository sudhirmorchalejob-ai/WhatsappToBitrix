const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCAL_TO_BITRIX24,
  BITRIX24_STATUSES,
  mapProviderStatusToLocal,
  normalizeBitrix24Status,
  localToBitrix24,
  extractProviderMessageId,
} = require('./status');
const { MESSAGE_STATUS } = require('../../constants');

test('mapProviderStatusToLocal maps common provider states', () => {
  assert.equal(mapProviderStatusToLocal('delivrd'), MESSAGE_STATUS.DELIVERED);
  assert.equal(mapProviderStatusToLocal('DELIVRD'), MESSAGE_STATUS.DELIVERED);
  assert.equal(mapProviderStatusToLocal('accepted'), MESSAGE_STATUS.SENT);
  assert.equal(mapProviderStatusToLocal('queued'), MESSAGE_STATUS.PENDING);
  assert.equal(mapProviderStatusToLocal('undeliv'), MESSAGE_STATUS.UNDELIVERED);
  assert.equal(mapProviderStatusToLocal('failed'), MESSAGE_STATUS.FAILED);
  assert.equal(mapProviderStatusToLocal('read'), MESSAGE_STATUS.READ);
});

test('mapProviderStatusToLocal falls back to FAILED on unknown state', () => {
  assert.equal(mapProviderStatusToLocal('some-bizarre-state'), MESSAGE_STATUS.FAILED);
});

test('mapProviderStatusToLocal returns null for empty input', () => {
  assert.equal(mapProviderStatusToLocal(''), null);
  assert.equal(mapProviderStatusToLocal(undefined), null);
  assert.equal(mapProviderStatusToLocal(null), null);
});

test('normalizeBitrix24Status validates against the official vocabulary', () => {
  for (const s of BITRIX24_STATUSES) {
    assert.equal(normalizeBitrix24Status(s.toUpperCase()), s);
    assert.equal(normalizeBitrix24Status(s), s);
  }
  assert.equal(normalizeBitrix24Status('read'), null);
  assert.equal(normalizeBitrix24Status('bogus'), null);
  assert.equal(normalizeBitrix24Status(''), null);
});

test('localToBitrix24 maps local states to Bitrix24 STATUS values', () => {
  assert.equal(localToBitrix24(MESSAGE_STATUS.PENDING), 'queued');
  assert.equal(localToBitrix24(MESSAGE_STATUS.SENT), 'sent');
  assert.equal(localToBitrix24(MESSAGE_STATUS.DELIVERED), 'delivered');
  assert.equal(localToBitrix24(MESSAGE_STATUS.UNDELIVERED), 'undelivered');
  assert.equal(localToBitrix24(MESSAGE_STATUS.FAILED), 'failed');
  // READ is not in the Bitrix24 SMS vocabulary -> collapse to delivered.
  assert.equal(localToBitrix24(MESSAGE_STATUS.READ), 'delivered');
  assert.equal(localToBitrix24('UNKNOWN'), 'failed');
});

test('LOCAL_TO_BITRIX24 covers every local status', () => {
  for (const key of Object.keys(MESSAGE_STATUS)) {
    assert.ok(LOCAL_TO_BITRIX24[MESSAGE_STATUS[key]], `missing mapping for ${MESSAGE_STATUS[key]}`);
  }
});

test('extractProviderMessageId finds the id across common payload shapes', () => {
  assert.equal(extractProviderMessageId({ msgid: '123' }), '123');
  assert.equal(extractProviderMessageId({ message_id: 'abc' }), 'abc');
  assert.equal(extractProviderMessageId({ messageId: 42 }), '42');
  assert.equal(extractProviderMessageId({ request_id: 'req-1' }), 'req-1');
  assert.equal(extractProviderMessageId({ data: { id: 'd-1' } }), 'd-1');
  assert.equal(extractProviderMessageId({ result: { id: 'r-1' } }), 'r-1');
  // Precedence: msgid wins over the rest.
  assert.equal(
    extractProviderMessageId({ msgid: 'm-1', message_id: 'm-2', data: { id: 'm-3' } }),
    'm-1'
  );
  assert.equal(extractProviderMessageId({}), null);
  assert.equal(extractProviderMessageId(null), null);
  assert.equal(extractProviderMessageId('nope'), null);
});
