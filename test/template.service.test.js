const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TemplateService } = require('../src/services/template.service');

const ROW = { id: 1, name: 'Welcome', body: 'Hi {{firstName}}!', category: 'greeting', isActive: true, isDefault: false, usageCount: 0 };

function createFakes({ rows = [], store = [] } = {}) {
  const calls = { create: [], clearDefault: [], update: [], delete: [], incrementUsage: [] };

  const templateRepo = {
    create: async (data) => {
      calls.create.push(data);
      const row = { id: store.length + 1, ...data, usageCount: 0 };
      store.push(row);
      return row;
    },
    findById: async (id) => rows.find((r) => r.id === id) || store.find((r) => r.id === id) || null,
    findDefault: async () => rows.find((r) => r.isDefault && r.isActive) || store.find((r) => r.isDefault && r.isActive) || null,
    list: async (q) => ({ items: rows, total: rows.length }),
    update: async (id, data) => {
      calls.update.push({ id, data });
      return { id, ...data };
    },
    delete: async (id) => {
      calls.delete.push(id);
    },
    clearDefault: async () => {
      calls.clearDefault.push(true);
    },
    incrementUsage: async (id) => {
      calls.incrementUsage.push(id);
    },
  };

  const service = new TemplateService({ templateRepo });
  return { service, calls };
}

test('create with isDefault clears the existing default first', async () => {
  const { service, calls } = createFakes();
  await service.create({ name: 'Away', body: 'We are away', isDefault: true });
  assert.deepEqual(calls.clearDefault, [true]);
  assert.deepEqual(calls.create, [{ name: 'Away', body: 'We are away', isDefault: true }]);
});

test('create without isDefault does not clear defaults', async () => {
  const { service, calls } = createFakes();
  await service.create({ name: 'Hi', body: 'Hello' });
  assert.equal(calls.clearDefault.length, 0);
});

test('get returns the row and throws 404 when missing', async () => {
  const { service } = createFakes({ rows: [ROW] });
  const found = await service.get(1);
  assert.equal(found.name, 'Welcome');
  await assert.rejects(() => service.get(999), (err) => err.code === 'TEMPLATE_NOT_FOUND' && err.statusCode === 404);
});

test('update throws 404 when the template is missing', async () => {
  const { service } = createFakes({ rows: [] });
  await assert.rejects(() => service.update(5, { body: 'x' }), (err) => err.code === 'TEMPLATE_NOT_FOUND');
});

test('update promoting isDefault clears other defaults', async () => {
  const { service, calls } = createFakes({ rows: [ROW] });
  await service.update(1, { isDefault: true });
  assert.deepEqual(calls.clearDefault, [true]);
  assert.deepEqual(calls.update, [{ id: 1, data: { isDefault: true } }]);
});

test('delete throws 404 when the template is missing', async () => {
  const { service } = createFakes({ rows: [] });
  await assert.rejects(() => service.delete(9), (err) => err.code === 'TEMPLATE_NOT_FOUND');
});

test('delete removes an existing template', async () => {
  const { service, calls } = createFakes({ rows: [ROW] });
  const result = await service.delete(1);
  assert.equal(result, true);
  assert.deepEqual(calls.delete, [1]);
});

test('render substitutes known variables and blanks unknown ones', () => {
  const { service } = createFakes();
  const out = service.render('Hi {{firstName}} {{lastName}} ({{phone}}) {{unknown}}!', {
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+15551234567',
  });
  assert.equal(out, 'Hi Jane Doe (+15551234567) !');
});

test('render tolerates whitespace inside braces', () => {
  const { service } = createFakes();
  assert.equal(service.render('Hi {{ name }}!', { name: 'Bob' }), 'Hi Bob!');
});

test('findDefault delegates to the repository', async () => {
  const defaultRow = { ...ROW, isDefault: true };
  const { service } = createFakes({ rows: [ROW, defaultRow] });
  const fallback = await service.findDefault();
  assert.equal(fallback, defaultRow);
});
