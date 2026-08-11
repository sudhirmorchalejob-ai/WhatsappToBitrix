const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ConversationService } = require('./conversation.service');
const { MESSAGE_STATUS } = require('../constants');

function makeFakeRepos(existingStatus) {
  let current = { id: 1, status: existingStatus, sentAt: null };
  const calls = { updateStatus: [], statusCreate: [] };
  return {
    calls,
    async findById() {
      return { ...current };
    },
    async updateStatus(messageId, status, opts) {
      calls.updateStatus.push({ messageId, status, opts });
      current = { ...current, status, sentAt: opts.sentAt || current.sentAt };
    },
    messageStatusRepo: {
      async create(data) {
        calls.statusCreate.push(data);
        return { id: 10 };
      },
    },
  };
}

let messageRepo;
let service;

beforeEach(() => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.SENT);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
});

test('recordMessageStatus allows a delivered message to flip to FAILED (SMS report)', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.DELIVERED);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.FAILED, error: 'carrier rejected' });
  assert.deepEqual(messageRepo.calls.updateStatus, [
    { messageId: 1, status: MESSAGE_STATUS.FAILED, opts: { error: 'carrier rejected' } },
  ]);
});

test('recordMessageStatus allows a delivered message to flip to UNDELIVERED', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.DELIVERED);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.UNDELIVERED });
  assert.equal(messageRepo.calls.updateStatus[0].status, MESSAGE_STATUS.UNDELIVERED);
});

test('recordMessageStatus does NOT downgrade delivered back to sent', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.DELIVERED);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.SENT });
  assert.equal(messageRepo.calls.updateStatus.length, 0);
});

test('recordMessageStatus still records the status event row even when main state is unchanged', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.DELIVERED);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.SENT, providerStatus: 'sent' });
  assert.equal(messageRepo.calls.updateStatus.length, 0);
  assert.equal(messageRepo.calls.statusCreate.length, 1);
  assert.equal(messageRepo.calls.statusCreate[0].status, MESSAGE_STATUS.SENT);
});

test('recordMessageStatus allows DELIVERED to move forward to READ', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.DELIVERED);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.READ });
  assert.equal(messageRepo.calls.updateStatus[0].status, MESSAGE_STATUS.READ);
});

test('recordMessageStatus sets sentAt the first time a message reaches SENT', async () => {
  messageRepo = makeFakeRepos(MESSAGE_STATUS.PENDING);
  service = new ConversationService({
    messageRepo,
    messageStatusRepo: messageRepo.messageStatusRepo,
  });
  const ts = new Date();
  await service.recordMessageStatus({ messageId: 1, status: MESSAGE_STATUS.SENT, timestamp: ts });
  assert.equal(messageRepo.calls.updateStatus[0].opts.sentAt, ts);
});

test('recordMessageStatus throws MESSAGE_NOT_FOUND for a missing message', async () => {
  service = new ConversationService({
    messageRepo: { async findById() { return null; } },
    messageStatusRepo: { async create() {} },
  });
  await assert.rejects(
    () => service.recordMessageStatus({ messageId: 999, status: MESSAGE_STATUS.FAILED }),
    (err) => err.statusCode === 404
  );
});
