const logger = require('../utils/logger');
const { env } = require('../config');
const { ContactRepository } = require('../repositories');
const { Bitrix24Service } = require('../services/bitrix24');

const log = logger.childFor('job:resync-contacts');

/**
 * Periodically pushes contacts that were created locally while the CRM
 * was unreachable (syncStatus PENDING/FAILED) up to Bitrix24. Searches
 * first so an existing contact is linked instead of duplicated.
 */
class ResyncContactsJob {
  constructor({
    contactRepo = new ContactRepository(),
    bitrix24 = new Bitrix24Service(),
    intervalMs = env.RETRY_INTERVAL_MS,
  } = {}) {
    this.contactRepo = contactRepo;
    this.bitrix24 = bitrix24;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.run().catch((err) => log.error('resync run crashed', { error: err.message }));
    }, this.intervalMs);
    this.timer.unref();
    log.info('resync-contacts job started', { intervalMs: this.intervalMs });
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  async run() {
    if (this.running) return { scanned: 0, skipped: true, reason: 'already-running' };
    if (!this.bitrix24.isConfigured()) {
      return { scanned: 0, skipped: true, reason: 'bitrix24-not-configured' };
    }

    this.running = true;
    try {
      const contacts = await this.contactRepo.findUnsynced({ limit: 50 });
      const results = [];
      for (const contact of contacts) {
        results.push(await this._syncOne(contact));
      }
      return { scanned: contacts.length, results };
    } finally {
      this.running = false;
    }
  }

  async _syncOne(contact) {
    try {
      const existing = await this.bitrix24.searchContactByPhone(contact.whatsappPhone);
      const b24Id =
        existing && existing.ID
          ? Number(existing.ID)
          : Number(
              await this.bitrix24.createContact({
                name: contact.name || contact.firstName || `+${contact.whatsappPhone}`,
                lastName: contact.lastName || undefined,
                phone: contact.whatsappPhone,
                email: contact.email || undefined,
                company: contact.company || undefined,
              })
            );
      await this.contactRepo.markSynced(contact.id, b24Id);
      log.info('contact synced to Bitrix24', { contactId: contact.id, bitrix24ContactId: b24Id });
      return { contactId: contact.id, ok: true, bitrix24ContactId: b24Id };
    } catch (err) {
      await this.contactRepo.markSyncFailed(contact.id, { error: err.message, lastAttemptAt: new Date().toISOString() });
      log.warn('contact resync failed', { contactId: contact.id, error: err.message });
      return { contactId: contact.id, ok: false, error: err.message };
    }
  }
}

module.exports = { ResyncContactsJob };
