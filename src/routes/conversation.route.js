const { Router } = require('express');
const { validate } = require('../validators');
const {
  listConversationsQuerySchema,
  conversationParamSchema,
  assignConversationBodySchema,
} = require('../validators');
const { defaultController: conversationController } = require('../controllers/conversation.controller');

const router = Router();

router.get('/', validate(listConversationsQuerySchema, 'query'), conversationController.listConversations);
router.get('/:id', validate(conversationParamSchema, 'params'), conversationController.getConversation);
router.post('/:id/read', validate(conversationParamSchema, 'params'), conversationController.markConversationRead);
router.post(
  '/:id/assign',
  validate(conversationParamSchema, 'params'),
  validate(assignConversationBodySchema, 'body'),
  conversationController.assignConversation,
);
router.post('/:id/unassign', validate(conversationParamSchema, 'params'), conversationController.unassignConversation);

module.exports = router;
