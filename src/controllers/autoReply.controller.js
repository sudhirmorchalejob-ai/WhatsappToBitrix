const { sendSuccess } = require('../utils/ApiResponse');
const { paginateMeta } = require('../utils/pagination');
const { AutoReplyLogRepository } = require('../repositories');

/**
 * REST handlers for /api/auto-replies. Lists the audit trail of automatic
 * replies fired from the WhatsApp side, scoped to the caller's tenant.
 */
function createAutoReplyController({ repo = new AutoReplyLogRepository() } = {}) {
  async function listAutoReplies(req, res) {
    const { items, total } = await repo.list({
      tenantId: req.tenantId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  return { listAutoReplies };
}

module.exports = { createAutoReplyController, defaultController: createAutoReplyController() };
