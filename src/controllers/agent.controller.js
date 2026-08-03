const { sendSuccess } = require('../utils/ApiResponse');
const { RoutingService } = require('../services/routing.service');

/**
 * REST handlers for /api/agents. Read-only directory of active operators
 * (with their current open-chat load) consumed by the app UI.
 */
function createAgentController({ routingService = new RoutingService() } = {}) {
  async function listAgents(req, res) {
    const agents = await routingService.listAgents();
    return sendSuccess(res, agents);
  }

  return { listAgents };
}

module.exports = { createAgentController, defaultController: createAgentController() };
