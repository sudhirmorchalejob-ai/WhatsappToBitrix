const { sendSuccess } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { paginateMeta } = require('../utils/pagination');
const { ConversationRepository, ContactRepository } = require('../repositories');
const { RoutingService } = require('../services/routing.service');

function createConversationController({
  conversationRepo = new ConversationRepository(),
  contactRepo = new ContactRepository(),
  routingService = new RoutingService(),
} = {}) {
  async function listConversations(req, res) {
    const tenantId = req.tenantId || (req.user && req.user.tenantId);
    const limit = Number(req.query.limit) || 50;
    const includeAll = req.query.includeAll === 'true' || req.query.includeAll === '1';

    const { items, total } = await conversationRepo.list({
      ...req.query,
      tenantId,
    });

    if (!includeAll) {
      return sendSuccess(res, items, {
        meta: paginateMeta({ total, limit, offset: req.query.offset }),
      });
    }

    // WhatsApp Chats view: show real conversations first, then every synced
    // contact that has no chat yet, so the full contact list is visible.
    const excludeIds = items.map((c) => c.contactId);
    const contacts = await contactRepo.listWithoutConversations({
      tenantId,
      excludeIds,
      limit,
    });
    const virtualChats = contacts.map((c) => ({
      id: -Number(c.id),
      virtual: true,
      tenantId: c.tenantId,
      contactId: c.id,
      channelNumber: c.whatsappPhone,
      status: 'OPEN',
      lastMessageAt: null,
      lastMessagePreview: null,
      lastMessageDirection: null,
      lastMessageType: null,
      unreadCount: 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      contact: c,
      assignedAgent: null,
    }));

    return sendSuccess(res, [...items, ...virtualChats], {
      meta: paginateMeta({
        total: total + virtualChats.length,
        limit,
        offset: req.query.offset,
      }),
    });
  }

  async function getConversation(req, res) {
    const conversation = await conversationRepo.findById(req.params.id);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, null, 'CONVERSATION_NOT_FOUND');
    }
    return sendSuccess(res, conversation);
  }

  async function markConversationRead(req, res) {
    const conversation = await conversationRepo.markRead(req.params.id);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, null, 'CONVERSATION_NOT_FOUND');
    }
    return sendSuccess(res, { id: Number(req.params.id), unreadCount: 0 });
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

  return { listConversations, getConversation, markConversationRead, assignConversation, unassignConversation };
}

module.exports = { createConversationController, defaultController: createConversationController() };
