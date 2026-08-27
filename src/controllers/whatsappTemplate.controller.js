const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { paginateMeta } = require('../utils/pagination');
const { WhatsAppTemplateService } = require('../services/whatsappTemplate.service');

function createWhatsAppTemplateController({ templateService = new WhatsAppTemplateService() } = {}) {
  async function listTemplates(req, res) {
    const { items, total } = await templateService.list(req.tenantId, {
      category: req.query.category,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function getTemplate(req, res) {
    const template = await templateService.getByName(
      req.params.name,
      req.query.language || 'en',
      req.tenantId
    );
    if (!template) {
      return sendSuccess(res, null, { message: 'Template not found' });
    }
    return sendSuccess(res, template);
  }

  async function syncTemplates(req, res) {
    const templates = await templateService.fetchAndCache(req.tenantId, { force: true });
    return sendSuccess(res, { synced: templates.length, templates });
  }

  return { listTemplates, getTemplate, syncTemplates };
}

module.exports = { createWhatsAppTemplateController, defaultController: createWhatsAppTemplateController() };
