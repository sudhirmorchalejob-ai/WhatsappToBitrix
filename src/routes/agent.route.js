const { Router } = require('express');
const { defaultController: agentController } = require('../controllers/agent.controller');

const router = Router();

router.get('/', agentController.listAgents);

module.exports = router;
