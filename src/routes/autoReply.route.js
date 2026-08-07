const { Router } = require('express');
const { defaultController: autoReplyController } = require('../controllers/autoReply.controller');

const router = Router();

router.get('/', autoReplyController.listAutoReplies);

module.exports = router;
