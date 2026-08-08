const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookController } = require('../src/webhooks/bitrix24/webhook.controller');

function operatorPayload() {
  return {
    event: 'ONIMCONNECTORMESSAGEADD',
    ts: 1773759161,
    data: {
      CONNECTOR: 'myconnector',
      LINE: 107,
      MESSAGES: [
        {
          im: { chat_id: 1807, message_id: 86497 },
          message: { user_id: 27, text: 'Hello' },
          chat: { id: 'channel-123' },
        },
      ],
    },
    auth: { member_id: 'm1', application_token: 'apptok', access_token: 'fresh' },
  };
}

function mockReq(payload, install = { memberId: 'm1', applicationToken: 'apptok' }) {
  return {
    b24Auth: { payload, auth: payload.auth, memberId: 'm1', install },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function makeFakes(overrides = {}) {
  const calls = { logs: [], processed: [], failed: [], handler: [] };

  const webhookLogRepository = {
    create: async (log) => {
      calls.logs.push(log);
      return { id: calls.logs.length };
    },
    markProcessed: async (id, data) => {
      calls.processed.push({ id, ...data });
    },
  };

  const handler = {
    handle: async (canonical, ctx) => {
      calls.handler.push({ canonical, ctx });
      if (overrides.handlerError) throw overrides.handlerError;
      return overrides.handlerResult || { handled: true, messageId: 5, agentId: 7 };
    },
  };

  const controller = createWebhookController({ webhookLogRepository, handler });
  return { controller, calls };
}

test('processes an operator message end-to-end', async () => {
  const { controller, calls } = makeFakes();
  const req = mockReq(operatorPayload());
  const res = mockRes();
  await controller.handle(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.received, 1);
  assert.equal(res.body.data.processed[0].ok, true);

  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].source, 'BITRIX24');
  assert.equal(calls.logs[0].eventType, 'ONIMCONNECTORMESSAGEADD:operatorMessage');
  assert.equal(calls.logs[0].status, 'RECEIVED');
  assert.equal(calls.logs[0].ip, '127.0.0.1');

  assert.equal(calls.processed.length, 1);
  assert.equal(calls.processed[0].status, 'PROCESSED');

  assert.equal(calls.handler.length, 1);
  assert.equal(calls.handler[0].ctx.install.memberId, 'm1');
  assert.equal(calls.handler[0].ctx.auth.access_token, 'fresh');
});

test('a handler failure is logged as FAILED but the response stays 200', async () => {
  const { controller, calls } = makeFakes({ handlerError: new Error('db exploded') });
  const req = mockReq(operatorPayload());
  const res = mockRes();
  await controller.handle(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.processed[0].ok, false);
  assert.equal(res.body.data.processed[0].error, 'db exploded');

  assert.equal(calls.logs[0].status, 'RECEIVED');
  assert.equal(calls.processed[0].status, 'FAILED');
  assert.equal(calls.processed[0].errorMessage, 'db exploded');
});

test('expands multi-message payloads into one log row each', async () => {
  const payload = operatorPayload();
  payload.data.MESSAGES.push({
    im: { chat_id: 1807, message_id: 86498 },
    message: { user_id: 28, text: 'Second' },
    chat: { id: 'channel-123' },
  });
  const { controller, calls } = makeFakes();
  const req = mockReq(payload);
  const res = mockRes();
  await controller.handle(req, res);

  assert.equal(res.body.data.received, 2);
  assert.equal(calls.logs.length, 2);
  assert.equal(calls.handler.length, 2);
});
