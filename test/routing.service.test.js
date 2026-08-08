const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config');
const { ROUTING_STRATEGY, AGENT_ROLE } = require('../src/constants');
const { RoutingService } = require('../src/services/routing.service');

// ------------------------------------------------------------------ helpers

function makeAgent(overrides = {}) {
  return {
    id: 1,
    bitrix24UserId: 101,
    name: 'Alice',
    email: 'alice@example.com',
    isActive: true,
    isSupervisor: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeStats(entries = {}) {
  const map = new Map();
  for (const [agentId, { load = 0, lastAssignedAt = null } = {}] of Object.entries(entries)) {
    map.set(Number(agentId), {
      load,
      lastAssignedAt: lastAssignedAt ? new Date(lastAssignedAt) : null,
    });
  }
  return map;
}

function createFakes({ agents = [], stats = new Map(), contactAssignment = null } = {}) {
  const calls = { assign: [], update: [], unassign: [] };

  const agentRepo = {
    findById: async (id) => agents.find((a) => a.id === id) || null,
    findByBitrix24Id: async (uid) => agents.find((a) => a.bitrix24UserId === uid) || null,
    listActive: async () => agents.filter((a) => a.isActive),
  };

  const assignmentRepo = {
    findActiveByContact: async () => contactAssignment,
    loadAndRecencyByAgent: async () => stats,
    assign: async ({ conversationId, agentId, assignedByAgentId = null }) => {
      calls.assign.push({ conversationId, agentId, assignedByAgentId });
      return { id: 1000, conversationId, agentId, assignedByAgentId };
    },
    unassign: async (conversationId) => {
      calls.unassign.push(conversationId);
      return { count: 1 };
    },
  };

  const conversationRepo = {
    update: async (id, data) => {
      calls.update.push({ id, data });
      return { id, ...data };
    },
    findById: async (id) => (id === 10 ? { id: 10, assignedAgentId: null } : null),
  };

  const service = new RoutingService({ agentRepo, assignmentRepo, conversationRepo });
  return { service, calls };
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

const conv = (overrides = {}) => ({ id: 10, assignedAgentId: null, ...overrides });
const contact = { id: 5, whatsappPhone: '15551234567' };

// ------------------------------------------------------------- assignIfNeeded

test('assignIfNeeded keeps an existing assignment', async () => {
  const { service, calls } = createFakes();
  const result = await withEnv({ ROUTING_ENABLED: true }, () =>
    service.assignIfNeeded({ conversation: conv({ assignedAgentId: 7 }) })
  );
  assert.deepEqual(result, { assigned: false, reason: 'already-assigned', agentId: 7 });
  assert.equal(calls.assign.length, 0);
});

test('assignIfNeeded is a no-op when routing is disabled', async () => {
  const { service } = createFakes();
  const result = await withEnv({ ROUTING_ENABLED: false }, () =>
    service.assignIfNeeded({ conversation: conv(), contact })
  );
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'routing-disabled');
});

test('assignIfNeeded manual takeover (byUserId) wins over auto-routing', async () => {
  const { service, calls } = createFakes({
    agents: [makeAgent({ id: 1, bitrix24UserId: 101, isSupervisor: true })],
  });
  const result = await withEnv({ ROUTING_ENABLED: true }, () =>
    service.assignIfNeeded({ conversation: conv(), contact, byUserId: 101 })
  );
  assert.equal(result.assigned, true);
  assert.equal(result.reason, 'manual');
  assert.equal(result.agentId, 1);
  assert.deepEqual(calls.assign[0], { conversationId: 10, agentId: 1, assignedByAgentId: 101 });
});

test('assignIfNeeded routes a returning customer back to the same operator', async () => {
  const previousAgent = makeAgent({ id: 3, bitrix24UserId: 303 });
  const { service, calls } = createFakes({
    agents: [makeAgent({ id: 1 }), previousAgent],
    contactAssignment: { agent: previousAgent },
  });
  const result = await withEnv({ ROUTING_ENABLED: true }, () =>
    service.assignIfNeeded({ conversation: conv(), contact })
  );
  assert.equal(result.assigned, true);
  assert.equal(result.reason, 'contact-reuse');
  assert.equal(result.agentId, 3);
  assert.deepEqual(calls.assign[0], { conversationId: 10, agentId: 3, assignedByAgentId: null });
});

test('assignIfNeeded ignores a contact-level assignment from an inactive agent', async () => {
  const { service } = createFakes({
    agents: [makeAgent({ id: 1 })],
    contactAssignment: { agent: makeAgent({ id: 9, isActive: false }) },
  });
  const result = await withEnv({ ROUTING_ENABLED: true }, () =>
    service.assignIfNeeded({ conversation: conv(), contact })
  );
  assert.equal(result.assigned, true);
  assert.equal(result.reason, 'auto');
  assert.equal(result.agentId, 1);
});

test('assignIfNeeded auto-routes via the strategy when there is no reuse', async () => {
  const agents = [
    makeAgent({ id: 1, bitrix24UserId: 101 }),
    makeAgent({ id: 2, bitrix24UserId: 102 }),
  ];
  const { service } = createFakes({ agents, stats: makeStats({ 1: { load: 5 }, 2: { load: 1 } }) });
  const result = await withEnv(
    { ROUTING_ENABLED: true, ROUTING_STRATEGY: ROUTING_STRATEGY.LEAST_LOADED },
    () => service.assignIfNeeded({ conversation: conv(), contact })
  );
  assert.equal(result.assigned, true);
  assert.equal(result.reason, 'auto');
  assert.equal(result.agentId, 2, 'least-loaded agent wins');
});

test('assignIfNeeded reports no-agents when the roster is empty', async () => {
  const { service } = createFakes();
  const result = await withEnv({ ROUTING_ENABLED: true }, () =>
    service.assignIfNeeded({ conversation: conv(), contact })
  );
  assert.deepEqual(result, { assigned: false, reason: 'no-agents' });
});

// ------------------------------------------------------------------ pickAgent

test('pickAgent least-loaded prefers fewer open chats, LRU as tie-break', () => {
  const agents = [
    makeAgent({ id: 1 }),
    makeAgent({ id: 2 }),
    makeAgent({ id: 3 }),
  ];
  const stats = makeStats({
    1: { load: 2, lastAssignedAt: '2026-01-01T10:00:00Z' },
    2: { load: 2, lastAssignedAt: '2026-01-01T09:00:00Z' },
    3: { load: 0 },
  });
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents, stats, strategy: ROUTING_STRATEGY.LEAST_LOADED });
  assert.equal(picked.id, 3, 'agent with no open chats wins');
});

test('pickAgent round-robin picks the longest-waiting agent (LRU)', () => {
  const agents = [makeAgent({ id: 1 }), makeAgent({ id: 2 }), makeAgent({ id: 3 })];
  const stats = makeStats({
    1: { load: 4, lastAssignedAt: '2026-01-01T12:00:00Z' },
    2: { load: 0, lastAssignedAt: '2026-01-01T08:00:00Z' },
    3: { load: 2, lastAssignedAt: '2026-01-01T10:00:00Z' },
  });
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents, stats, strategy: ROUTING_STRATEGY.ROUND_ROBIN });
  assert.equal(picked.id, 2, 'oldest assignment waits longest');
});

test('pickAgent excludes supervisors unless every agent is one', () => {
  const agents = [
    makeAgent({ id: 1, isSupervisor: true }),
    makeAgent({ id: 2 }),
    makeAgent({ id: 3, isSupervisor: true }),
  ];
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents, stats: makeStats(), excludeSupervisors: true });
  assert.equal(picked.id, 2);
});

test('pickAgent skips agents at cap unless all candidates are capped', () => {
  const agents = [makeAgent({ id: 1 }), makeAgent({ id: 2 }), makeAgent({ id: 3 })];
  const stats = makeStats({ 1: { load: 10 }, 2: { load: 10 }, 3: { load: 3 } });
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents, stats, maxActive: 10 });
  assert.equal(picked.id, 3);
});

test('pickAgent returns the least-loaded agent when everyone is at cap', () => {
  const agents = [makeAgent({ id: 1 }), makeAgent({ id: 2 })];
  const stats = makeStats({ 1: { load: 10 }, 2: { load: 9 } });
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents, stats, maxActive: 10 });
  assert.equal(picked.id, 2);
});

test('pickAgent returns null when no agent is eligible', () => {
  const service = new RoutingService({});
  const picked = service.pickAgent({ agents: [], stats: makeStats() });
  assert.equal(picked, null);
});

// ---------------------------------------------------------------- assign

test('assign throws when the agent is missing or inactive', async () => {
  const { service } = createFakes({ agents: [makeAgent({ id: 1, isActive: false })] });
  await assert.rejects(
    () => service.assign({ conversationId: 10, agentId: 999 }),
    (err) => err.code === 'AGENT_NOT_FOUND'
  );
  await assert.rejects(
    () => service.assign({ conversationId: 10, agentId: 1 }),
    (err) => err.code === 'AGENT_INACTIVE'
  );
});

test('assign updates the conversation and writes an audit row', async () => {
  const { service, calls } = createFakes({ agents: [makeAgent({ id: 1 })] });
  const result = await service.assign({ conversationId: 10, agentId: 1, byUserId: 101 });
  assert.equal(result.agent.id, 1);
  assert.deepEqual(calls.update, [{ id: 10, data: { assignedAgentId: 1 } }]);
  assert.deepEqual(calls.assign, [{ conversationId: 10, agentId: 1, assignedByAgentId: 101 }]);
});

test('assignByUser resolves a Bitrix24 user id and allows a takeover', async () => {
  const { service, calls } = createFakes({
    agents: [makeAgent({ id: 1, bitrix24UserId: 101 }), makeAgent({ id: 2, bitrix24UserId: 102 })],
  });
  const result = await service.assignByUser({ conversationId: 10, byUserId: 102 });
  assert.equal(result.agent.id, 2);
  assert.deepEqual(calls.assign[0], { conversationId: 10, agentId: 2, assignedByAgentId: 102 });
});

test('assignByUser rejects an unknown Bitrix24 user', async () => {
  const { service } = createFakes({ agents: [makeAgent({ id: 1 })] });
  await assert.rejects(
    () => service.assignByUser({ conversationId: 10, byUserId: 999 }),
    (err) => err.code === 'AGENT_NOT_FOUND'
  );
});

test('assignByUser requires byUserId', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.assignByUser({ conversationId: 10, byUserId: null }),
    (err) => err.code === 'BY_USER_ID_REQUIRED'
  );
});

// ---------------------------------------------------------------- unassign

test('unassign clears the audit row and the conversation owner', async () => {
  const { service, calls } = createFakes();
  const result = await service.unassign({ conversationId: 10, byUserId: 101 });
  assert.equal(result.unassigned, true);
  assert.deepEqual(calls.unassign, [10]);
  assert.deepEqual(calls.update, [{ id: 10, data: { assignedAgentId: null } }]);
});

test('unassign throws when the conversation is missing', async () => {
  const { service } = createFakes();
  await assert.rejects(
    () => service.unassign({ conversationId: 999 }),
    (err) => err.code === 'CONVERSATION_NOT_FOUND'
  );
});

// --------------------------------------------------------------- listAgents

test('listAgents reports role labels and open-chat load', async () => {
  const { service } = createFakes({
    agents: [
      makeAgent({ id: 1, bitrix24UserId: 101, name: 'Alice', email: 'a@x.com', isSupervisor: false }),
      makeAgent({ id: 2, bitrix24UserId: 102, name: 'Bob', email: 'b@x.com', isSupervisor: true }),
    ],
    stats: makeStats({
      1: { load: 3, lastAssignedAt: '2026-01-01T10:00:00Z' },
    }),
  });
  const agents = await service.listAgents();
  assert.equal(agents.length, 2);
  const alice = agents.find((a) => a.id === 1);
  assert.equal(alice.role, AGENT_ROLE.OPERATOR);
  assert.equal(alice.openChats, 3);
  assert.equal(alice.lastAssignedAt.toISOString(), '2026-01-01T10:00:00.000Z');
  const bob = agents.find((a) => a.id === 2);
  assert.equal(bob.role, AGENT_ROLE.SUPERVISOR);
  assert.equal(bob.openChats, 0);
});
