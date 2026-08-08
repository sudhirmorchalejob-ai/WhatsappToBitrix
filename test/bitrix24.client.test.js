const { test } = require('node:test');
const assert = require('node:assert');
const { mapAxiosError, isTransient, isAuthError, Bitrix24Client } = require('../src/services/bitrix24/client');
const { Bitrix24ApiError } = require('../src/services/bitrix24/bitrix24.error');

test('mapAxiosError: HTTP 200 with error body becomes Bitrix24ApiError', () => {
  const err = mapAxiosError({
    response: { status: 200, data: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'slow down' } },
  });
  assert.ok(err instanceof Bitrix24ApiError);
  assert.strictEqual(err.code, 'QUERY_LIMIT_EXCEEDED');
  assert.strictEqual(err.statusCode, 502);
});

test('mapAxiosError: plain HTTP 5xx maps to HTTP_5xx', () => {
  const err = mapAxiosError({ response: { status: 500, data: '<html>' } });
  assert.ok(err instanceof Bitrix24ApiError);
  assert.strictEqual(err.code, 'HTTP_500');
});

test('mapAxiosError: network failure maps to NETWORK_ERROR', () => {
  const err = mapAxiosError({ request: {}, code: 'ECONNREFUSED', message: 'connect' });
  assert.ok(err instanceof Bitrix24ApiError);
  assert.strictEqual(err.code, 'NETWORK_ERROR');
});

test('mapAxiosError: passes through existing Bitrix24ApiError', () => {
  const original = new Bitrix24ApiError('already', 'X');
  assert.strictEqual(mapAxiosError(original), original);
});

test('isTransient: rate limit codes are transient, generic are not', () => {
  assert.strictEqual(isTransient(new Bitrix24ApiError('limit', 'QUERY_LIMIT_EXCEEDED')), true);
  assert.strictEqual(isTransient(new Bitrix24ApiError('slow down please', 'SLOW_DOWN')), true);
  assert.strictEqual(isTransient(new Bitrix24ApiError('http 500', 'HTTP_500')), true);
  assert.strictEqual(isTransient(new Bitrix24ApiError('bad method', 'INVALID_ARGUMENT')), false);
  assert.strictEqual(isTransient(new Error('plain')), false);
});

test('isAuthError identifies expired/invalid token responses only', () => {
  assert.strictEqual(isAuthError(new Bitrix24ApiError('gone', 'expired_token')), true);
  assert.strictEqual(isAuthError(new Bitrix24ApiError('gone', 'invalid_token')), true);
  assert.strictEqual(isAuthError(new Bitrix24ApiError('gone', 'WRONG_AUTH')), true);
  assert.strictEqual(isAuthError(new Bitrix24ApiError('auth invalid', 'INVALID_TOKEN')), true);
  assert.strictEqual(isAuthError(new Bitrix24ApiError('slow down', 'QUERY_LIMIT_EXCEEDED')), false);
});

function stubHttpCall(client, responses) {
  const posted = [];
  client.http.post = async (url, body) => {
    posted.push({ url, body });
    const next = responses.shift();
    if (next && next.throw) throw next.throw;
    return { data: next.data };
  };
  return posted;
}

test('call attaches the access token as the auth param', async () => {
  const client = new Bitrix24Client('https://portal.bitrix24.com/rest/', { accessToken: 'tok-1' });
  const posted = stubHttpCall(client, [{ data: { result: 'ok' } }]);
  await client.call('app.info', {});
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'app.info.json');
  assert.equal(posted[0].body.auth, 'tok-1');
});

test('call does not attach auth when no token is configured', async () => {
  const client = new Bitrix24Client('https://portal.bitrix24.com/rest/1/abc/');
  const posted = stubHttpCall(client, [{ data: { result: 'ok' } }]);
  await client.call('app.info', { scope: 'x' });
  assert.equal(posted[0].body.auth, undefined);
});

test('call rotates the token through onAuthFailure and retries once', async () => {
  const client = new Bitrix24Client('https://portal.bitrix24.com/rest/', { accessToken: 'stale' });
  const posted = stubHttpCall(client, [
    { throw: new Bitrix24ApiError('token expired', 'expired_token', 502) },
    { data: { result: 'ok' } },
  ]);
  let refreshCount = 0;
  client.setOnAuthFailure(async () => {
    refreshCount += 1;
    return 'fresh';
  });
  const res = await client.call('app.info', {});
  assert.equal(res.result, 'ok');
  assert.equal(refreshCount, 1);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].body.auth, 'stale');
  assert.equal(posted[1].body.auth, 'fresh');
  assert.equal(client.accessToken, 'fresh');
});

test('call propagates the refresh error when onAuthFailure fails', async () => {
  const client = new Bitrix24Client('https://portal.bitrix24.com/rest/', { accessToken: 'stale' });
  stubHttpCall(client, [
    { throw: new Bitrix24ApiError('token expired', 'expired_token', 502) },
    { data: { result: 'ok' } },
  ]);
  client.setOnAuthFailure(async () => {
    throw new Bitrix24ApiError('refresh rejected', 'invalid_grant', 502);
  });
  await assert.rejects(() => client.call('app.info', {}), { code: 'invalid_grant' });
});

test('batch requests carry the access token too', async () => {
  const client = new Bitrix24Client('https://portal.bitrix24.com/rest/', { accessToken: 'tok-b' });
  const posted = stubHttpCall(client, [{ data: { result: { result: ['a', 'b'] } } }]);
  const res = await client.batch(['user.get?id=1']);
  assert.deepEqual(res, ['a', 'b']);
  assert.equal(posted[0].body.auth, 'tok-b');
  assert.equal(posted[0].body.cmd.length, 1);
});
