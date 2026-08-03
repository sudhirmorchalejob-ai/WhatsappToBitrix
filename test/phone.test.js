const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePhone, comparePhones } = require('../src/helpers/phone');

test('normalizePhone strips everything but digits', () => {
  assert.strictEqual(normalizePhone('+1 (555) 123-4567'), '15551234567');
  assert.strictEqual(normalizePhone('15551234567'), '15551234567');
  assert.strictEqual(normalizePhone('  4444  '), '4444');
  assert.strictEqual(normalizePhone(null), '');
  assert.strictEqual(normalizePhone(undefined), '');
  assert.strictEqual(normalizePhone(''), '');
});

test('normalizePhone handles 00 international prefix', () => {
  assert.strictEqual(normalizePhone('00445551234567'), '445551234567');
});

test('comparePhones matches identical numbers', () => {
  assert.strictEqual(comparePhones('+15551234567', '15551234567'), true);
  assert.strictEqual(comparePhones('15551234567', '(555) 123-4567'), true);
});

test('comparePhones matches local number without country code', () => {
  assert.strictEqual(comparePhones('15551234567', '5551234567'), true);
});

test('comparePhones rejects different numbers', () => {
  assert.strictEqual(comparePhones('15551234567', '15559876543'), false);
  assert.strictEqual(comparePhones('', '15551234567'), false);
});
