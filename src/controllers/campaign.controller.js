const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { paginateMeta } = require('../utils/pagination');
const { CampaignService } = require('../services/campaign.service');

/**
 * REST handlers for /api/campaigns. Thin adapters: validation happened in
 * the router, business rules live in CampaignService. The tenant context
 * middleware supplies req.tenantId, so campaigns stay isolated per tenant.
 */
function createCampaignController({ campaignService = new CampaignService() } = {}) {
  async function listCampaigns(req, res) {
    const { items, total } = await campaignService.list(req.query, req.tenantId);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function createCampaign(req, res) {
    const campaign = await campaignService.create(req.body, req.tenantId);
    return sendCreated(res, campaign);
  }

  async function getCampaign(req, res) {
    const campaign = await campaignService.get(req.params.id, req.tenantId);
    return sendSuccess(res, campaign);
  }

  async function updateCampaign(req, res) {
    const campaign = await campaignService.update(req.params.id, req.body, req.tenantId);
    return sendSuccess(res, campaign);
  }

  async function deleteCampaign(req, res) {
    await campaignService.delete(req.params.id, req.tenantId);
    return sendSuccess(res, { deleted: true, id: Number(req.params.id) });
  }

  async function executeCampaign(req, res) {
    const campaign = await campaignService.execute(req.params.id, {
      recipients: req.body.recipients,
      tenantId: req.tenantId,
    });
    return sendSuccess(res, campaign);
  }

  return { listCampaigns, createCampaign, getCampaign, updateCampaign, deleteCampaign, executeCampaign };
}

module.exports = { createCampaignController, defaultController: createCampaignController() };
