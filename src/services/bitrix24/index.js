const { Bitrix24Service } = require('./bitrix24.service');
const { Bitrix24OAuth } = require('./oauth');
const { Bitrix24ConnectorService } = require('./connector.service');

const bitrix24Service = new Bitrix24Service();
const bitrix24OAuth = new Bitrix24OAuth();
const bitrix24ConnectorService = new Bitrix24ConnectorService();

module.exports = {
  bitrix24Service,
  bitrix24OAuth,
  bitrix24ConnectorService,
  Bitrix24Service,
  Bitrix24OAuth,
  Bitrix24ConnectorService,
};
