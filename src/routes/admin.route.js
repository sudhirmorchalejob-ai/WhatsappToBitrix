const { Router } = require('express');
const { validate } = require('../validators');
const { retryOutgoingQuerySchema, listWebhookLogsQuerySchema } = require('../validators');
const { defaultController: adminController } = require('../controllers/admin.controller');

const router = Router();

router.get('/diagnostics', adminController.diagnostics);
router.post('/messages/retry', validate(retryOutgoingQuerySchema, 'query'), adminController.runRetry);
router.get('/webhooks', validate(listWebhookLogsQuerySchema, 'query'), adminController.listWebhooks);

module.exports = router;
