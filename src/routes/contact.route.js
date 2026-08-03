const { Router } = require('express');
const { validate } = require('../validators');
const { listContactsQuerySchema, contactParamSchema } = require('../validators');
const { defaultController: contactController } = require('../controllers/contact.controller');

const router = Router();

router.get('/', validate(listContactsQuerySchema, 'query'), contactController.listContacts);
router.get('/:id', validate(contactParamSchema, 'params'), contactController.getContact);

module.exports = router;
