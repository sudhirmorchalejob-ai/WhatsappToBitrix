const { Router } = require('express');
const { validate } = require('../validators');
const { setSettingSchema, listSettingsQuerySchema, settingParamSchema } = require('../validators');
const { defaultController: settingController } = require('../controllers/setting.controller');

const router = Router();

router.get('/', validate(listSettingsQuerySchema, 'query'), settingController.listSettings);
router.put('/', validate(setSettingSchema), settingController.setSetting);
router.get('/:key', validate(settingParamSchema, 'params'), settingController.getSetting);
router.delete('/:key', validate(settingParamSchema, 'params'), settingController.deleteSetting);

module.exports = router;
