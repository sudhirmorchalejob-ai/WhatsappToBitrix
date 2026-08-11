const { env } = require('../../config');
const { SettingRepository } = require('../../repositories');

const SMS_CONFIG_KEYS = Object.freeze({
  PROVIDER: 'sms_provider',
  API_URL: 'sms_api_url',
  API_KEY: 'sms_api_key',
  SENDER_ID: 'sms_sender_id',
  ROUTE: 'sms_route',
  TEMPLATE_ID: 'sms_template_id',
  WEBHOOK_SECRET: 'sms_webhook_secret',
});

const SMS_PROVIDERS = Object.freeze(['msg91', 'generic']);

/** Keys whose values must never be echoed back un-masked. */
const SMS_SECRET_KEYS = Object.freeze([SMS_CONFIG_KEYS.API_KEY, SMS_CONFIG_KEYS.WEBHOOK_SECRET]);

const MASK = '********';

/**
 * SMS gateway configuration. Resolution order is: per-tenant Setting row
 * (secrets flagged isSecret) over the .env defaults, so every tenant can
 * own its own gateway while a single default keeps setup zero-touch.
 */
class SmsConfigService {
  constructor({ settingRepo = new SettingRepository() } = {}) {
    this.settingRepo = settingRepo;
  }

  keys() {
    return SMS_CONFIG_KEYS;
  }

  secretKeys() {
    return SMS_SECRET_KEYS;
  }

  envDefaults() {
    return {
      [SMS_CONFIG_KEYS.PROVIDER]: String(env.SMS_PROVIDER || 'generic'),
      [SMS_CONFIG_KEYS.API_URL]: String(env.SMS_API_URL || ''),
      [SMS_CONFIG_KEYS.API_KEY]: String(env.SMS_API_KEY || ''),
      [SMS_CONFIG_KEYS.SENDER_ID]: String(env.SMS_SENDER_ID || ''),
      [SMS_CONFIG_KEYS.ROUTE]: String(env.SMS_ROUTE || ''),
      [SMS_CONFIG_KEYS.TEMPLATE_ID]: String(env.SMS_TEMPLATE_ID || ''),
      [SMS_CONFIG_KEYS.WEBHOOK_SECRET]: String(env.SMS_WEBHOOK_SECRET || ''),
    };
  }

  async get(tenantId = null) {
    const config = this.envDefaults();
    const rows = await this.settingRepo.list({ includeSecrets: true, tenantId });
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(config, row.key)) {
        config[row.key] = row.value == null ? '' : String(row.value);
      }
    }
    return config;
  }

  /**
   * Public view of the config with secrets masked. Used by the dashboard
   * GET endpoint; the raw secret is only ever written, never returned.
   */
  async getPublic(tenantId = null) {
    const config = await this.get(tenantId);
    for (const key of SMS_SECRET_KEYS) {
      if (config[key]) config[key] = MASK;
    }
    return { config, masked: true };
  }

  /** Persists tenant overrides; an empty string removes the override. */
  async save(tenantId, input = {}) {
    const validKeys = Object.values(SMS_CONFIG_KEYS);
    for (const [key, value] of Object.entries(input)) {
      if (!validKeys.includes(key)) continue;
      const isSecret = SMS_SECRET_KEYS.includes(key);
      const normalized = String(value == null ? '' : value).trim();
      if (normalized === '' || normalized === MASK) {
        await this.settingRepo.remove(key, tenantId);
      } else {
        await this.settingRepo.set(key, normalized, {
          type: 'string',
          isSecret,
          tenantId,
        });
      }
    }
  }

  /** Provider name normalized to a known implementation. */
  providerName(config) {
    const name = String(config && config[SMS_CONFIG_KEYS.PROVIDER] || 'generic').toLowerCase();
    return SMS_PROVIDERS.includes(name) ? name : 'generic';
  }

  isConfigured(config) {
    if (!config || !config[SMS_CONFIG_KEYS.API_KEY]) return false;
    // MSG91 has a documented default endpoint; any other provider needs an
    // explicit API URL.
    if (this.providerName(config) === 'msg91') return true;
    return Boolean(config[SMS_CONFIG_KEYS.API_URL]);
  }

  /** True when any tenant (or the env default) has SMS credentials. */
  async isGloballyConfigured() {
    const defaults = this.envDefaults();
    if (defaults[SMS_CONFIG_KEYS.API_KEY] && defaults[SMS_CONFIG_KEYS.API_URL]) return true;
    const rows = await this.settingRepo.list({ includeSecrets: true });
    return rows.some(
      (row) =>
        row.key === SMS_CONFIG_KEYS.API_KEY &&
        row.value &&
        rows.some((r) => r.key === SMS_CONFIG_KEYS.API_URL && r.value)
    );
  }
}

module.exports = { SmsConfigService, SMS_CONFIG_KEYS, SMS_SECRET_KEYS, SMS_PROVIDERS, MASK };
