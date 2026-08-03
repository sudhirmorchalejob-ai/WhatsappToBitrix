const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config');
const { BITRIX24_METHODS, BITRIX24_EVENTS } = require('../src/constants');
const { Bitrix24ConnectorService } = require('../src/services/bitrix24/connector.service');

function makeInstallRow(overrides = {}) {
  return {
    memberId: 'm1',
    domain: 'portal.bitrix24.com',
    accessToken: 'ac',
    refreshToken: 'rf',
    connectorId: null,
    lineId: null,
    status: 'INSTALLED',
    ...overrides,
  };
}

function createFakes({ install = makeInstallRow() } = {}) {
  const calls = { call: [], bindEvents: [], openline: [] };

  const bitrix24 = {
    oauthCtx: null,
    call: async (method, params) => {
      calls.call.push({ method, params });
      return { ok: true, result: {} };
    },
    bindEvents: async (memberId, handlers) => {
      calls.bindEvents.push({ memberId, handlers });
      return handlers.map((h) => ({ event: h.event, ok: true }));
    },
  };

  const installRepo = {
    findActiveMostRecent: async () => install,
    findByMemberId: async () => install,
    updateOpenline: async (memberId, data) => {
      calls.openline.push({ memberId, data });
      return { memberId, ...data };
    },
  };

  const service = new Bitrix24ConnectorService({ installRepository: installRepo, bitrix24 });
  return { service, calls, bitrix24, installRepo };
}

async function withEnv(patch, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = env[k];
    env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete env[key];
      else env[key] = prev[key];
    }
  }
}

test('register posts imconnector.register with the configured id and placement URL', async () => {
  const { service, calls } = createFakes();
  await withEnv(
    { BITRIX24_CONNECTOR_ID: 'wa_whatsapp', APP_BASE_URL: 'https://app.example.com/' },
    async () => {
      await service.register('m1');
    }
  );
  const call = calls.call.find((c) => c.method === BITRIX24_METHODS.IMCONNECTOR_REGISTER);
  assert.ok(call, 'imconnector.register was called');
  assert.equal(call.params.ID, 'wa_whatsapp');
  assert.equal(call.params.NAME, 'WhatsApp');
  assert.equal(call.params.PLACEMENT_HANDLER, 'https://app.example.com/app/connector');
  assert.equal(call.params.CHAT_GROUP, false);
  assert.match(call.params.ICON.DATA_IMAGE, /^data:image\/svg\+xml;base64,/);
  assert.match(call.params.ICON_DISABLED.DATA_IMAGE, /^data:image\/svg\+xml;base64,/);
});

test('register rejects a connector id with dots (Bitrix24 rule)', async () => {
  const { service } = createFakes();
  await withEnv({ BITRIX24_CONNECTOR_ID: 'wa.whatsapp' }, () =>
    assert.rejects(() => service.register('m1'), /Invalid BITRIX24_CONNECTOR_ID/)
  );
});

test('activate flips the connector on for a line', async () => {
  const { service, calls } = createFakes();
  await service.activate('m1', { lineId: 17, active: true });
  const call = calls.call.find((c) => c.method === BITRIX24_METHODS.IMCONNECTOR_ACTIVATE);
  assert.ok(call);
  assert.equal(call.params.CONNECTOR, 'wa_whatsapp');
  assert.equal(call.params.LINE, 17);
  assert.equal(call.params.ACTIVE, '1');
});

test('activate can deactivate the connector', async () => {
  const { service, calls } = createFakes();
  await service.activate('m1', { lineId: 17, active: false });
  const call = calls.call.find((c) => c.method === BITRIX24_METHODS.IMCONNECTOR_ACTIVATE);
  assert.equal(call.params.ACTIVE, '0');
});

test('activate without a line is rejected', async () => {
  const { service } = createFakes();
  await assert.rejects(() => service.activate('m1', {}), /lineId is required/);
});

test('setData defaults to the ${connectorId}line${line} id convention', async () => {
  const { service, calls } = createFakes();
  await service.setData('m1', { lineId: 17 });
  const call = calls.call.find((c) => c.method === BITRIX24_METHODS.IMCONNECTOR_CONNECTOR_DATA_SET);
  assert.ok(call);
  assert.equal(call.params.CONNECTOR, 'wa_whatsapp');
  assert.equal(call.params.LINE, 17);
  assert.equal(call.params.DATA.id, 'wa_whatsappline17');
  assert.equal(call.params.DATA.name, 'WhatsApp');
});

test('sendCustomerMessage is skipped when no open line is configured', async () => {
  const { service, calls } = createFakes({ install: makeInstallRow({ lineId: null }) });
  await withEnv({ BITRIX24_OPENLINE_ID: 0 }, async () => {
    const result = await service.sendCustomerMessage({
      chatId: 'wa_10',
      contactName: 'John Doe',
      messageId: 100,
      body: 'hi',
    });
    assert.equal(result.sent, false);
    assert.equal(result.skipped, 'openline-not-configured');
    assert.equal(calls.call.length, 0);
  });
});

test('sendCustomerMessage forwards a customer message into the open line', async () => {
  const { service, calls } = createFakes({
    install: makeInstallRow({ connectorId: 'wa_whatsapp', lineId: 17 }),
  });
  const date = new Date('2026-01-01T10:00:00Z');
  await withEnv({ BITRIX24_OPENLINE_ID: 0 }, async () => {
    const result = await service.sendCustomerMessage({
      chatId: 'wa_10',
      contactName: 'John Doe',
      messageId: 100,
      body: 'Hello there',
      date,
    });
    assert.equal(result.sent, true);
  });

  const call = calls.call.find((c) => c.method === BITRIX24_METHODS.IMCONNECTOR_SEND_MESSAGES);
  assert.ok(call);
  assert.equal(call.params.CONNECTOR, 'wa_whatsapp');
  assert.equal(call.params.LINE, 17);
  const msg = call.params.MESSAGES[0];
  assert.deepEqual(msg.user, { id: 'wa_10', name: 'John Doe' });
  assert.equal(msg.message.id, '100');
  assert.equal(msg.message.date, Math.floor(date.getTime() / 1000));
  assert.equal(msg.message.text, 'Hello there');
  assert.deepEqual(msg.chat, { id: 'wa_10', name: 'John Doe' });
});

test('resolveOpenline prefers the stored install connector id and line', async () => {
  const { service } = createFakes({
    install: makeInstallRow({ connectorId: 'wa_custom', lineId: 42 }),
  });
  const portal = await withEnv({ BITRIX24_OPENLINE_ID: 0 }, () => service.resolveOpenline());
  assert.deepEqual(portal, { memberId: 'm1', connectorId: 'wa_custom', lineId: 42 });
});

test('resolveOpenline returns null without a configured line', async () => {
  const { service } = createFakes({ install: makeInstallRow({ lineId: null }) });
  const portal = await withEnv({ BITRIX24_OPENLINE_ID: 0 }, () => service.resolveOpenline());
  assert.equal(portal, null);
});

test('eventHandlers binds the connector message events to the webhook URL', async () => {
  const { service } = createFakes();
  const handlers = await withEnv({ APP_BASE_URL: 'https://app.example.com' }, () => service.eventHandlers());
  assert.equal(handlers.length, 2);
  assert.equal(handlers[0].event, BITRIX24_EVENTS.CONNECTOR_MESSAGE_ADD);
  assert.equal(handlers[1].event, BITRIX24_EVENTS.CONNECTOR_MESSAGE_UPDATE);
  for (const h of handlers) assert.equal(h.handler, 'https://app.example.com/webhooks/bitrix24');
});

test('eventHandlers is empty when APP_BASE_URL is not set', async () => {
  const { service } = createFakes();
  const handlers = await withEnv({ APP_BASE_URL: '' }, () => service.eventHandlers());
  assert.deepEqual(handlers, []);
});

test('bindEvents delegates to event.bind for the connector events', async () => {
  const { service, calls } = createFakes();
  const results = await withEnv({ APP_BASE_URL: 'https://app.example.com' }, () => service.bindEvents('m1'));
  assert.equal(calls.bindEvents.length, 1);
  assert.equal(calls.bindEvents[0].memberId, 'm1');
  assert.equal(calls.bindEvents[0].handlers.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test('provision registers + binds events and reports no activation without a line', async () => {
  const { service, calls } = createFakes();
  const summary = await withEnv(
    { APP_BASE_URL: 'https://app.example.com', BITRIX24_OPENLINE_ID: 0 },
    () => service.provision('m1')
  );
  assert.ok(summary.register, 'register attempted');
  assert.ok(Array.isArray(summary.bindings));
  assert.equal(summary.activation, null);
  assert.equal(summary.error, null);
  assert.equal(calls.openline.length, 0);
});

test('provision auto-activates and stores the line when one is configured', async () => {
  const { service, calls } = createFakes();
  const summary = await withEnv({ BITRIX24_OPENLINE_ID: 17 }, () => service.provision('m1'));
  assert.equal(summary.activation.lineId, 17);
  assert.deepEqual(calls.openline, [{ memberId: 'm1', data: { connectorId: 'wa_whatsapp', lineId: 17 } }]);
  const methods = calls.call.map((c) => c.method);
  assert.ok(methods.includes(BITRIX24_METHODS.IMCONNECTOR_ACTIVATE));
  assert.ok(methods.includes(BITRIX24_METHODS.IMCONNECTOR_CONNECTOR_DATA_SET));
});
