const { sendSuccess } = require('../utils/ApiResponse');
const { paginateMeta } = require('../utils/pagination');
const { DiagnosticsService } = require('../services/diagnostics.service');
const { WebhookLogRepository } = require('../repositories');

/**
 * REST handlers for /api/admin — operational diagnostics and manual
 * maintenance triggers for support personnel.
 */
function createAdminController({
  service = new DiagnosticsService(),
  webhookLogRepo = new WebhookLogRepository(),
} = {}) {
  async function diagnostics(req, res) {
    const data = await service.overview();
    return sendSuccess(res, data);
  }

  async function runRetry(req, res) {
    const result = await service.runRetryNow(req.query);
    return sendSuccess(res, result);
  }

  async function listWebhooks(req, res) {
    const { source, status, limit, offset } = req.query;
    const [items, total] = await Promise.all([
      webhookLogRepo.listRecent({ source, status, limit, offset }),
      webhookLogRepo.count({ source, status }),
    ]);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit, offset }),
    });
  }

  return { diagnostics, runRetry, listWebhooks };
}

module.exports = { createAdminController, defaultController: createAdminController() };
