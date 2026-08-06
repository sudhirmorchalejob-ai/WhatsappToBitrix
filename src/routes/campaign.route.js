const { Router } = require('express');
const { validate } = require('../validators');
const {
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsQuerySchema,
  campaignIdParamSchema,
  executeCampaignSchema,
} = require('../validators');
const { defaultController: campaignController } = require('../controllers/campaign.controller');

const router = Router();

router.get('/', validate(listCampaignsQuerySchema, 'query'), campaignController.listCampaigns);
router.post('/', validate(createCampaignSchema), campaignController.createCampaign);
router.get('/:id', validate(campaignIdParamSchema, 'params'), campaignController.getCampaign);
router.put('/:id', validate(campaignIdParamSchema, 'params'), validate(updateCampaignSchema), campaignController.updateCampaign);
router.delete('/:id', validate(campaignIdParamSchema, 'params'), campaignController.deleteCampaign);
router.post('/:id/execute', validate(campaignIdParamSchema, 'params'), validate(executeCampaignSchema), campaignController.executeCampaign);

module.exports = router;
