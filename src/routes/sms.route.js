const { Router } = require('express');
const { validate } = require('../validators');
const { smsConfigSchema, smsTestSchema } = require('../validators');
const { defaultController: smsController } = require('../controllers/sms.controller');

const router = Router();

router.get('/config', (req, res) => smsController.getConfig(req, res));
router.put('/config', validate(smsConfigSchema), (req, res) => smsController.saveConfig(req, res));
router.post('/test', validate(smsTestSchema), (req, res) => smsController.test(req, res));

module.exports = router;
