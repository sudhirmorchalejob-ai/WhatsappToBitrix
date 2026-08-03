const { Router } = require('express');
const { validate } = require('../validators');
const {
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,
} = require('../validators');
const { defaultController: templateController } = require('../controllers/template.controller');

const router = Router();

router.get('/', validate(listTemplatesQuerySchema, 'query'), templateController.listTemplates);
router.post('/', validate(createTemplateSchema), templateController.createTemplate);
router.get('/:id', validate(templateIdParamSchema, 'params'), templateController.getTemplate);
router.put('/:id', validate(templateIdParamSchema, 'params'), validate(updateTemplateSchema), templateController.updateTemplate);
router.delete('/:id', validate(templateIdParamSchema, 'params'), templateController.deleteTemplate);

module.exports = router;
