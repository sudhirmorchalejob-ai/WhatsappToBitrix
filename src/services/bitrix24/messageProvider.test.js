const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../../utils/AppError');
const { BITRIX24_METHODS, MESSAGE_PROVIDER } = require('../../constants');

// Must be set before the module is required: src/config reads process.env
// once at load and builds the handler URL from APP_BASE_URL.
process.env.APP_BASE_URL = 'https://sms.example.test';

const { Bitrix24MessageProviderService } = require('./messageProvider.service');

const CODE_PREFIX = MESSAGE_PROVIDER.CODE_PREFIX;

function makeFakeBitrix24() {
  const calls = [];
  return {
    calls,
    async callAsApp(memberId, method, payload) {
      calls.push({ memberId, method, payload });
      if (method === BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_LIST) {
        return this.listResult || [];
      }
      return { ok: true };
    },
    listResult: null,
  };
}

let bitrix24;
let service;

beforeEach(() => {
  bitrix24 = makeFakeBitrix24();
  service = new Bitrix24MessageProviderService({ bitrix24 });
});

test('providerCode encodes the member_id with the code prefix', () => {
  assert.equal(service.providerCode('abc123'), `${CODE_PREFIX}_abc123`);
  assert.equal(service.providerCode(123), `${CODE_PREFIX}_123`);
});

test('parseMemberIdFromCode round-trips the member_id', () => {
  assert.equal(service.parseMemberIdFromCode(`${CODE_PREFIX}_member-7`), 'member-7');
  assert.equal(service.parseMemberIdFromCode('garbage'), null);
  assert.equal(service.parseMemberIdFromCode(`${CODE_PREFIX}_`), null);
  assert.equal(service.parseMemberIdFromCode(null), null);
  assert.equal(service.parseMemberIdFromCode(''), null);
});

test('_assertCode rejects codes outside Bitrix24 rules', () => {
  assert.doesNotThrow(() => service._assertCode(`${CODE_PREFIX}_abc123`));
  assert.throws(() => service._assertCode('bad code with spaces'), (err) => err instanceof AppError && err.statusCode === 400);
  assert.throws(() => service._assertCode('x'.repeat(60)), (err) => err instanceof AppError && err.statusCode === 400);
});

test('handlerUrl() builds from APP_BASE_URL without trailing slash', () => {
  assert.equal(service.handlerUrl(), 'https://sms.example.test/api/bitrix24/sms');
});

test('register() updates instead of adding when the code already exists', async () => {
  bitrix24.listResult = [{ CODE: `${CODE_PREFIX}_mem1`, NAME: 'old' }];
  const result = await service.register('mem1');

  assert.equal(result.ok, true);
  assert.equal(result.updated, true);
  assert.equal(result.registered, false);

  const methods = bitrix24.calls.map((c) => c.method);
  assert.ok(methods.includes(BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_UPDATE));
  assert.ok(!methods.includes(BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_ADD));
});

test('register() adds when the code is not present', async () => {
  bitrix24.listResult = [{ CODE: 'some-other-provider' }];
  const result = await service.register('mem2');

  assert.equal(result.ok, true);
  assert.equal(result.registered, true);

  const methods = bitrix24.calls.map((c) => c.method);
  assert.ok(methods.includes(BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_ADD));
  const addCall = bitrix24.calls.find((c) => c.method === BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_ADD);
  assert.equal(addCall.memberId, 'mem2');
  assert.equal(addCall.payload.CODE, `${CODE_PREFIX}_mem2`);
  assert.equal(addCall.payload.TYPE, MESSAGE_PROVIDER.TYPE);
  assert.ok(addCall.payload.HANDLER.includes('/api/bitrix24/sms'));
  assert.equal(addCall.payload.NAME.en, MESSAGE_PROVIDER.NAME);
});

test('register() falls back to add when the list call throws', async () => {
  bitrix24.callAsApp = async (memberId, method) => {
    if (method === BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_LIST) throw new Error('list boom');
    return { ok: true };
  };
  const result = await service.register('mem3');
  assert.equal(result.ok, true);
  assert.equal(result.registered, true);
});

test('register() returns skipped when no handler URL is configured', async () => {
  const svc = new Bitrix24MessageProviderService({
    bitrix24: makeFakeBitrix24(),
    handlerUrlOverride: '',
  });
  svc.handlerUrl = () => '';
  const result = await svc.register('mem4');
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'no-handler-url');
  assert.equal(bitrix24.calls.length, 0);
});

test('unregister() deletes the provider for the portal', async () => {
  const result = await service.unregister('mem5');
  assert.equal(result.ok, true);
  const call = bitrix24.calls.find((c) => c.method === BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_DELETE);
  assert.ok(call);
  assert.equal(call.payload.CODE, `${CODE_PREFIX}_mem5`);
});

test('updateMessageStatus() calls the status endpoint with the B24 STATUS value', async () => {
  await service.updateMessageStatus('mem6', { messageId: 'msg-1', status: 'delivered' });
  const call = bitrix24.calls.find((c) => c.method === BITRIX24_METHODS.MESSAGE_SERVICE_MESSAGE_STATUS_UPDATE);
  assert.ok(call);
  assert.equal(call.payload.CODE, `${CODE_PREFIX}_mem6`);
  assert.equal(call.payload.MESSAGE_ID, 'msg-1');
  assert.equal(call.payload.STATUS, 'delivered');
});
