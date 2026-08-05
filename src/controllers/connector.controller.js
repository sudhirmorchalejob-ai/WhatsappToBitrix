const { ConnectorModuleController } = require('./connectorModule.controller');

const moduleController = new ConnectorModuleController();

class ConnectorController {
  async handle(req, res) {
    return moduleController.handlePlacement(req, res);
  }
}

module.exports = { ConnectorController };
