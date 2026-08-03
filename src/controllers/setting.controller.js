const { sendSuccess } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { SettingService } = require('../services/setting.service');

const MASK = '********';

/**
 * REST handlers for /api/settings. Secret values are masked on every
 * read path (list, get, set response) unless the explicit
 * `includeSecrets` flag was used on the list endpoint.
 */
function createSettingController({ service = new SettingService() } = {}) {
  async function listSettings(req, res) {
    const settings = await service.list({ includeSecrets: req.query.includeSecrets });
    return sendSuccess(res, settings);
  }

  async function getSetting(req, res) {
    const row = await service.getRaw(req.params.key);
    if (!row) {
      throw new AppError('Setting not found', 404, null, 'SETTING_NOT_FOUND');
    }
    if (row.isSecret) row.value = MASK;
    return sendSuccess(res, row);
  }

  async function setSetting(req, res) {
    const row = await service.set(req.body);
    if (row.isSecret) row.value = MASK;
    return sendSuccess(res, row, { status: 200, message: 'Setting saved' });
  }

  async function deleteSetting(req, res) {
    await service.remove(req.params.key);
    return sendSuccess(res, { removed: true });
  }

  return { listSettings, getSetting, setSetting, deleteSetting };
}

module.exports = { createSettingController, defaultController: createSettingController() };
