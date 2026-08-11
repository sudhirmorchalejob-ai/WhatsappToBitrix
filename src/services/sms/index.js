const { SmsService } = require('./sms.service');
const { SmsConfigService, SMS_CONFIG_KEYS, SMS_SECRET_KEYS, SMS_PROVIDERS, MASK } = require('./config.service');
const {
  mapProviderStatusToLocal,
  normalizeBitrix24Status,
  localToBitrix24,
  extractProviderMessageId,
} = require('./status');

const smsService = new SmsService();
const smsConfigService = new SmsConfigService();

module.exports = {
  smsService,
  smsConfigService,
  SmsService,
  SmsConfigService,
  SMS_CONFIG_KEYS,
  SMS_SECRET_KEYS,
  SMS_PROVIDERS,
  MASK,
  mapProviderStatusToLocal,
  normalizeBitrix24Status,
  localToBitrix24,
  extractProviderMessageId,
};
