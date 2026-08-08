const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { paginateMeta } = require('../utils/pagination');
const { TemplateService } = require('../services/template.service');

/**
 * REST handlers for /api/templates. Thin adapters: validation happened in
 * the router, business rules live in TemplateService.
 */
function createTemplateController({ templateService = new TemplateService() } = {}) {
  async function listTemplates(req, res) {
    const { items, total } = await templateService.list(req.query);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function createTemplate(req, res) {
    const template = await templateService.create(req.body);
    return sendCreated(res, template);
  }

  async function getTemplate(req, res) {
    const template = await templateService.get(req.params.id);
    return sendSuccess(res, template);
  }

  async function updateTemplate(req, res) {
    const template = await templateService.update(req.params.id, req.body);
    return sendSuccess(res, template);
  }

  async function deleteTemplate(req, res) {
    await templateService.delete(req.params.id);
    return sendSuccess(res, { deleted: true, id: Number(req.params.id) });
  }

  return { listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate };
}

module.exports = { createTemplateController, defaultController: createTemplateController() };
