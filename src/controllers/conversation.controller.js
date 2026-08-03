const { sendSuccess } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { paginateMeta } = require('../utils/pagination');
const { ConversationRepository } = require('../repositories');
const { RoutingService } = require('../services/routing.service');

/**
 * REST handlers for /api/conversations. Search + detail, plus operator
 * assignment control; the conversation lifecycle is otherwise driven by
 * the webhook/send paths.
 */
function createConversationController({
  conversationRepo = new ConversationRepository(),
  routingService = new RoutingService(),
} = {}) {
  async function listConversations(req, res) {
    const { items, total } = await conversationRepo.list(req.query);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function getConversation(req, res) {
    const conversation = await conversationRepo.findById(req.params.id);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, null, 'CONVERSATION_NOT_FOUND');
    }
    return sendSuccess(res, conversation);
  }

  async function assignConversation(req, res) {
    const { byUserId } = req.body;
    const result = await routingService.assignByUser({
      conversationId: req.params.id,
      byUserId,
    });
    return sendSuccess(res, {
      conversationId: Number(req.params.id),
      agentId: result.agent.id,
      byUserId,
    });
  }

  async function unassignConversation(req, res) {
    const { byUserId } = req.body || {};
    const result = await routingService.unassign({
      conversationId: req.params.id,
      byUserId: byUserId || null,
    });
    return sendSuccess(res, result);
  }

  return { listConversations, getConversation, assignConversation, unassignConversation };
}

module.exports = { createConversationController, defaultController: createConversationController() };
