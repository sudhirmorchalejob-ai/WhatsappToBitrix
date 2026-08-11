const { Bitrix24Service } = require('./bitrix24.service');
const { Bitrix24OAuth } = require('./oauth');
const { Bitrix24ConnectorService } = require('./connector.service');
const { Bitrix24MessageProviderService } = require('./messageProvider.service');

const bitrix24Service = new Bitrix24Service();
const bitrix24OAuth = new Bitrix24OAuth();
const bitrix24ConnectorService = new Bitrix24ConnectorService();
const bitrix24MessageProviderService = new Bitrix24MessageProviderService();

module.exports = {
  bitrix24Service,
  bitrix24OAuth,
  bitrix24ConnectorService,
  bitrix24MessageProviderService,
  Bitrix24Service,
  Bitrix24OAuth,
  Bitrix24ConnectorService,
  Bitrix24MessageProviderService,
};
