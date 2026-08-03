const { Router } = require('express');
const { validate } = require('../validators');
const {
  sendTextSchema,
  sendMediaSchema,
  listMessagesQuerySchema,
  messageParamSchema,
} = require('../validators');
const { defaultController: messageController } = require('../controllers/message.controller');

const router = Router();

router.post('/send', validate(sendTextSchema), messageController.sendText);
router.post('/media', validate(sendMediaSchema), messageController.sendMedia);
router.get('/', validate(listMessagesQuerySchema, 'query'), messageController.listMessages);
router.get('/:id', validate(messageParamSchema, 'params'), messageController.getMessage);

module.exports = router;
