const { Router, json, urlencoded } = require('express');
const { InstallController } = require('../controllers/install.controller');
const { ConnectorController } = require('../controllers/connector.controller');

const controller = new InstallController();
const connectorController = new ConnectorController();
const router = Router();

// Bitrix24 calls these public endpoints; no API key is required.
router.get('/install', (req, res) => controller.install(req, res));

router.post('/install', json(), urlencoded({ extended: true }), (req, res) => controller.installEvent(req, res));

router.post('/uninstall', json(), urlencoded({ extended: true }), (req, res) => controller.uninstall(req, res));

router.get('/app/settings', (req, res) => controller.settings(req, res));

// Open Channels placement page (SETTING_CONNECTOR). Bitrix24 passes the
// tokens + PLACEMENT_OPTIONS in the query string, so GET is sufficient.
router.get('/app/connector', (req, res) => connectorController.handle(req, res));

module.exports = router;
