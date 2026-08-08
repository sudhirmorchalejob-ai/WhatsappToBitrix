const { sendSuccess } = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const { paginateMeta } = require('../utils/pagination');
const { ContactRepository } = require('../repositories');

/**
 * REST handlers for /api/contacts. Read-only search + detail; contact
 * creation is driven by the inbound webhook / outgoing send path.
 */
function createContactController({ contactRepo = new ContactRepository() } = {}) {
  async function listContacts(req, res) {
    const { items, total } = await contactRepo.list(req.query);
    return sendSuccess(res, items, {
      meta: paginateMeta({ total, limit: req.query.limit, offset: req.query.offset }),
    });
  }

  async function getContact(req, res) {
    const contact = await contactRepo.findById(req.params.id);
    if (!contact) {
      throw new AppError('Contact not found', 404, null, 'CONTACT_NOT_FOUND');
    }
    return sendSuccess(res, contact);
  }

  return { listContacts, getContact };
}

module.exports = { createContactController, defaultController: createContactController() };
