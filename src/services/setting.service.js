const AppError = require('../utils/AppError');
const { SettingRepository } = require('../repositories');

const VALID_TYPES = ['string', 'number', 'boolean', 'json'];

/**
 * Business rules for DB-backed configuration (settings screen).
 *
 * The repository stores values as JSON; this service is responsible for
 * the type-aware contract: `value` must match the declared `type`, so a
 * settings UI can render an editor and the rest of the app can rely on
 * the stored shape. Secret values are always masked in responses unless
 * `includeSecrets` is explicitly requested.
 */
class SettingService {
  constructor({ settingRepo = new SettingRepository() } = {}) {
    this.settingRepo = settingRepo;
  }

  async getValue(key, fallback = null) {
    const value = await this.settingRepo.get(key);
    return value === null || value === undefined ? fallback : value;
  }

  async getRaw(key) {
    return this.settingRepo.getRaw(key);
  }

  async set({ key, value, type = 'string', description = null, isSecret = false }) {
    const coerced = this._coerce(value, type);
    return this.settingRepo.set(key, coerced, { type, description, isSecret });
  }

  async remove(key) {
    const existing = await this.settingRepo.getRaw(key);
    if (!existing) {
      throw new AppError('Setting not found', 404, null, 'SETTING_NOT_FOUND');
    }
    await this.settingRepo.remove(key);
    return true;
  }

  async list({ includeSecrets = false } = {}) {
    return this.settingRepo.list({ includeSecrets });
  }

  // ------------------------------------------------------------------
  // Type contract
  // ------------------------------------------------------------------

  /**
   * Validates and normalizes a value against the declared type:
   *   string  -> must be a string
   *   number  -> number, or a numeric string (stored as a number)
   *   boolean -> boolean, or 'true'/'false' (stored as a boolean)
   *   json    -> anything, stored as-is
   * Rejects mismatches with a structured 400 so a malformed settings
   * payload can never corrupt a configuration row.
   */
  _coerce(value, type) {
    if (!VALID_TYPES.includes(type)) {
      throw new AppError(`Invalid setting type: ${type}`, 400, null, 'INVALID_SETTING_TYPE');
    }

    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new AppError('Setting of type string must be a string', 400, null, 'INVALID_SETTING_VALUE');
        }
        return value;
      case 'number': {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
          return Number(value);
        }
        throw new AppError('Setting of type number must be numeric', 400, null, 'INVALID_SETTING_VALUE');
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new AppError('Setting of type boolean must be true or false', 400, null, 'INVALID_SETTING_VALUE');
      case 'json':
      default:
        return value;
    }
  }
}

module.exports = { SettingService, VALID_TYPES };
