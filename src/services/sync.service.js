const { Bitrix24Client } = require('./bitrix24/client');
const { TenantRepository } = require('../repositories/tenant.repository');
const { ContactRepository } = require('../repositories/contact.repository');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { BITRIX24_METHODS, SYNC_STATUS } = require('../constants');
const { normalizePhone } = require('../helpers/phone');
const { env } = require('../config');
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

const LEAD_SELECT = [
  'ID',
  'TITLE',
  'NAME',
  'LAST_NAME',
  'PHONE',
  'EMAIL',
  'COMPANY_TITLE',
  'STATUS_ID',
  'DATE_CREATE',
  'DATE_MODIFY',
];

/**
 * Pulls Bitrix24 CRM contacts AND leads into the local Contact table for a
 * tenant. Contacts are matched by Bitrix24 id first, then by normalized phone,
 * so a re-sync updates existing rows instead of duplicating them. Rows without
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
      leadsSynced: 0,
      leadsCreated: 0,
      leadsUpdated: 0,
      leadsSkipped: 0,
      error: null,
      errorCode: null,
    };

    try {
      const tenant = tId ? await this.tenantRepo.findById(tId) : null;
      // Prefer the tenant row, but fall back to the server env so a fresh
      // database (Docker/local) can still pull from the configured portal.
      const b24Url = (tenant && tenant.bitrix24WebhookUrl) || env.BITRIX24_WEBHOOK_URL || null;
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

      // Pull Bitrix24 leads into the same Contact table so the dashboard
      // reflects the full CRM dataset (contact-origin + lead-origin rows).
      start = 0;
      let leadPages = 0;
      let leadFetched = 0;
      do {
        const res = await client.call(BITRIX24_METHODS.LEAD_LIST, {
          select: LEAD_SELECT,
          order: { ID: 'ASC' },
          start,
        });
        const items = (res && res.result) || [];
        if (!items.length) break;

        for (const item of items) {
          const outcome = await this.upsertLead(tId, item);
          result.leadsSynced += 1;
          if (outcome === 'created') result.leadsCreated += 1;
          else if (outcome === 'updated') result.leadsUpdated += 1;
          else result.leadsSkipped += 1;
          leadFetched += 1;
        }

        leadPages += 1;
        start = res && res.next ? Number(res.next) : 0;
      } while (start > 0 && leadFetched < limit && leadPages < maxPages);

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
          leadsCreated: result.leadsCreated,
          leadsUpdated: result.leadsUpdated,
          leadsSkipped: result.leadsSkipped,
          leadsTotal: result.leadsSynced,
        },
        ipAddress,
      });

      if (tId) {
        await this.tenantRepo.update(tId, { lastSyncedAt: new Date() });
      }
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

    // Atomic upsert on the (tenantId, whatsappPhone) unique key prevents a
    // unique-constraint race when two sync runs overlap.
    await this.contactRepo.upsertByWhatsappPhone(phone, tenantId, {
      ...fields,
      createdVia: 'BITRIX24_SYNC',
      bitrix24ContactId,
    });
    return 'created';
  }

  async upsertLead(tenantId, b24Lead) {
    const bitrix24LeadId = Number(b24Lead.ID);
    const phone = this.pickPhone(b24Lead.PHONE);
    if (!phone) return 'skipped';

    const firstName = this.truncate(b24Lead.NAME, 255);
    const lastName = this.truncate(b24Lead.LAST_NAME, 255);
    const title = this.truncate(b24Lead.TITLE, 255);
    const name = this.truncate([firstName, lastName].filter(Boolean).join(' '), 255) || title || null;
    const email = this.truncate(this.pickEmail(b24Lead.EMAIL), 255);
    const company = this.truncate(b24Lead.COMPANY_TITLE, 255);
    const meta = {
      source: 'bitrix24-lead-pull',
      bitrix24LeadId,
      statusId: b24Lead.STATUS_ID || null,
      bitrix24UpdatedAt: b24Lead.DATE_MODIFY || b24Lead.DATE_CREATE || null,
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

    const existingByLead = await this.contactRepo.findByBitrix24LeadId(bitrix24LeadId, tenantId);
    if (existingByLead) {
      await this.contactRepo.update(existingByLead.id, fields);
      return 'updated';
    }

    const existingByPhone = await this.contactRepo.findByWhatsappPhone(phone, tenantId);
    if (existingByPhone) {
      const mergedMeta = { ...(existingByPhone.meta || {}), ...meta };
      await this.contactRepo.update(existingByPhone.id, { ...fields, meta: mergedMeta });
      return 'updated';
    }

    await this.contactRepo.upsertByWhatsappPhone(phone, tenantId, {
      ...fields,
      createdVia: 'BITRIX24_SYNC',
      bitrix24ContactId: null,
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
