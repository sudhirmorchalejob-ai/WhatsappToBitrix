const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { paginateMeta } = require('../utils/pagination');
const { OutgoingMessageService } = require('../services/outgoingMessage.service');
const { MessageRepository } = require('../repositories');

/**
 * REST handlers for the /api/messages routes. Thin adapters: validate
 * already happened in the router, business rules live in the service,
 * persistence in the repository. The factory accepts dependencies so
 * tests can inject fakes for each piece.
 */
function createMessageController({ service = new OutgoingMessageService(), messageRepo = new MessageRepository() } = {}) {
  async function sendText(req, res) {
    const message = await service.sendText(req.body);
    return sendCreated(res, message);
  }

  async function sendMedia(req, res) {
    const message = await service.sendMedia(req.body);
    return sendCreated(res, message);
  }

  async function listMessages(req, res) {
    const { items, total } = await messageRepo.list(req.query);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function getMessage(req, res) {
    const message = await messageRepo.findById(req.params.id);
    if (!message) {
      throw new AppError('Message not found', 404, null, 'MESSAGE_NOT_FOUND');
    }
    return sendSuccess(res, message);
  }

  return { sendText, sendMedia, listMessages, getMessage };
}

module.exports = { createMessageController, defaultController: createMessageController() };
