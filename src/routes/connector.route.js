const { Router, json, urlencoded } = require('express');
const { ConnectorModuleController } = require('../controllers/connectorModule.controller');

const controller = new ConnectorModuleController();
const router = Router();

// OAuth install handler — GET/POST /api/connector/install
router.get('/install', (req, res) => controller.handleInstall(req, res));
router.post('/install', json(), urlencoded({ extended: true }), (req, res) => controller.handleInstall(req, res));

// Placement / Settings handler — GET/POST /api/connector/handler
router.get('/handler', (req, res) => controller.handlePlacement(req, res));
router.post('/handler', json(), urlencoded({ extended: true }), (req, res) => controller.handlePlacement(req, res));

// Left-sidebar (DEFAULT placement) app handler — auto-auth into the SPA
router.get('/app', (req, res) => controller.handleAppPlacement(req, res));
router.post('/app', json(), urlencoded({ extended: true }), (req, res) => controller.handleAppPlacement(req, res));

module.exports = router;
