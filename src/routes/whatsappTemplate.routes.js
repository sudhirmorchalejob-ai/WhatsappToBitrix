const { Router } = require('express');
const { defaultController } = require('../controllers/whatsappTemplate.controller');

const router = Router();

router.get('/', defaultController.listTemplates);
router.post('/sync', defaultController.syncTemplates);
router.get('/:name', defaultController.getTemplate);

module.exports = router;
