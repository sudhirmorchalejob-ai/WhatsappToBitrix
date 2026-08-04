const { Bitrix24Client } = require('./bitrix24/client');
const { TenantRepository } = require('../repositories/tenant.repository');
const { ContactRepository } = require('../repositories/contact.repository');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { BITRIX24_METHODS, SYNC_STATUS } = require('../constants');
const { normalizePhone } = require('../helpers/phone');
const logger = require('../utils/logger');

const log = logger.childFor('sync');

const DEFAULT_CONTACT_LIMIT = 200;
const DEFAULT_MAX_PAGES = 5;

const CONTACT_SELECT = [
  'ID',
  'NAME',
  'LAST_NAME',
  'PHONE',
  'EMAIL',
  'COMPANY_TITLE',
  'COMMENTS',
  'DATE_CREATE',
  'DATE_MODIFY',
];

/**
 * Pulls Bitrix24 CRM contacts into the local Contact table for a tenant.
 * Contacts are matched by Bitrix24 id first, then by normalized phone, so a
 * re-sync updates existing rows instead of duplicating them. Contacts without
 * a usable phone number cannot be stored (whatsappPhone is required) and are
 * counted as skipped.
 */
class SyncService {
  constructor({ tenantRepo, contactRepo, activityLogRepo, createClient } = {}) {
    this.tenantRepo = tenantRepo || new TenantRepository();
    this.contactRepo = contactRepo || new ContactRepository();
    this.activityLogRepo = activityLogRepo || new ActivityLogRepository();
    this.createClient = createClient || ((baseURL) => new Bitrix24Client(baseURL));
  }

  async syncContactsFromBitrix24(
    tenantId,
    { userId = null, ipAddress = null, limit = DEFAULT_CONTACT_LIMIT, maxPages = DEFAULT_MAX_PAGES } = {}
  ) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const result = {
      ok: true,
      tenantId: tId,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      error: null,
      errorCode: null,
    };

    try {
      const tenant = tId ? await this.tenantRepo.findById(tId) : null;
      const b24Url = tenant && tenant.bitrix24WebhookUrl;
      if (!b24Url) {
        result.ok = false;
        result.errorCode = 'B24_NOT_CONFIGURED';
        result.error = 'Bitrix24 webhook URL is not configured for this tenant';
        return result;
      }

      const client = this.createClient(b24Url);
      let start = 0;
      let fetched = 0;
      let pages = 0;

      do {
        const res = await client.call(BITRIX24_METHODS.CONTACT_LIST, {
          select: CONTACT_SELECT,
          order: { ID: 'ASC' },
          start,
        });
        const items = (res && res.result) || [];
        if (!items.length) break;

        for (const item of items) {
          const outcome = await this.upsertContact(tId, item);
          result.synced += 1;
          if (outcome === 'created') result.created += 1;
          else if (outcome === 'updated') result.updated += 1;
          else result.skipped += 1;
          fetched += 1;
        }

        pages += 1;
        start = res && res.next ? Number(res.next) : 0;
      } while (start > 0 && fetched < limit && pages < maxPages);

      await this.activityLogRepo.log({
        tenantId: tId,
        userId,
        action: 'CONTACTS_SYNCED_FROM_BITRIX24',
        category: 'INTEGRATION',
        details: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          total: result.synced,
        },
        ipAddress,
      });
    } catch (err) {
      result.ok = false;
      result.errorCode = err.code || 'SYNC_FAILED';
      result.error = err.message || String(err);
      log.error('Bitrix24 contact pull sync failed', {
        tenantId: tId,
        code: result.errorCode,
        message: result.error,
      });
      await this.activityLogRepo.log({
        tenantId: tId,
        userId,
        action: 'CONTACTS_SYNC_FAILED',
        category: 'INTEGRATION',
        details: { error: result.error, errorCode: result.errorCode },
        ipAddress,
      });
    }

    return result;
  }

  async upsertContact(tenantId, b24Contact) {
    const bitrix24ContactId = Number(b24Contact.ID);
    const phone = this.pickPhone(b24Contact.PHONE);
    if (!phone) return 'skipped';

    const firstName = this.truncate(b24Contact.NAME, 255);
    const lastName = this.truncate(b24Contact.LAST_NAME, 255);
    const name = this.truncate([firstName, lastName].filter(Boolean).join(' '), 255) || null;
    const email = this.truncate(this.pickEmail(b24Contact.EMAIL), 255);
    const company = this.truncate(b24Contact.COMPANY_TITLE, 255);
    const meta = {
      source: 'bitrix24-pull',
      bitrix24UpdatedAt: b24Contact.DATE_MODIFY || b24Contact.DATE_CREATE || null,
    };

    const fields = {
      firstName,
      lastName,
      name,
      email,
      company,
      syncStatus: SYNC_STATUS.SYNCED,
      meta,
    };

    const existingByB24 = await this.contactRepo.findByBitrix24Id(bitrix24ContactId, tenantId);
    if (existingByB24) {
      await this.contactRepo.update(existingByB24.id, fields);
      return 'updated';
    }

    const existingByPhone = await this.contactRepo.findByWhatsappPhone(phone, tenantId);
    if (existingByPhone) {
      await this.contactRepo.update(existingByPhone.id, { ...fields, bitrix24ContactId });
      return 'updated';
    }

    await this.contactRepo.create({
      tenantId,
      whatsappPhone: phone,
      ...fields,
      createdVia: 'BITRIX24_SYNC',
      bitrix24ContactId,
    });
    return 'created';
  }

  pickPhone(phones) {
    if (!Array.isArray(phones)) return null;
    let fallback = null;
    for (const p of phones) {
      const normalized = normalizePhone(p && p.VALUE);
      if (!normalized) continue;
      if (normalized.length >= 5 && normalized.length <= 20) return normalized;
      if (!fallback && normalized.length >= 5) fallback = normalized;
    }
    // Bitrix24 often concatenates several numbers into one VALUE; keep the
    // first 20 digits so the value fits the whatsappPhone column.
    return fallback ? fallback.slice(0, 20) : null;
  }

  pickEmail(emails) {
    if (!Array.isArray(emails)) return null;
    const entry = emails.find((e) => e && e.VALUE);
    return entry ? entry.VALUE : null;
  }

  truncate(value, max) {
    if (value === null || value === undefined) return null;
    const str = String(value);
    return str.length > max ? str.slice(0, max) : str;
  }
}

module.exports = { SyncService };
