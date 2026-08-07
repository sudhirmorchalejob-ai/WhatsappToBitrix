const logger = require('../utils/logger');
const { normalizePhone } = require('../helpers/phone');
const { Bitrix24Service } = require('./bitrix24');
const { BITRIX24_METHODS } = require('../constants');

const log = logger.childFor('segment-resolver');

/**
 * Source id stamped on Bitrix24 leads created for campaign traffic, so
 * operators can attribute a lead to a marketing campaign at a glance.
 */
const CAMPAIGN_B24_SOURCE_ID = 'WHATSAPP_CAMPAIGN';

/**
 * Segment catalog: Bitrix24 audience segments a campaign can target.
 *
 * `resolve` maps each segment to the CRM entities that currently belong
 * to it and returns their phone numbers. Most segments map to a simple
 * crm.contact.list / crm.lead.list / crm.deal.list filter; the seasonal
 * sale segments are defined in Bitrix24's marketing centre and are not
 * reproducible from CRM records, so they fall back to the full client &
 * lead audience (documented below).
 */
const CAMPAIGN_SEGMENTS = Object.freeze([
  { key: 'all_clients_and_leads', name: 'All Clients and Leads', description: 'Every contact and lead in the CRM' },
  { key: 'all_clients', name: 'All Clients', description: 'All CRM contacts' },
  { key: 'all_leads', name: 'All Leads', description: 'All CRM leads' },
  { key: 'active_deals_in_progress', name: 'Clients with Active Deals in Progress', description: 'Contacts with a deal in an active pipeline stage' },
  { key: 'clients_with_lost_deals', name: 'Clients with Lost Deals', description: 'Contacts with a lost deal' },
  { key: 'clients_with_won_deals', name: 'Clients with Won Deals', description: 'Contacts with a won deal' },
  { key: 'contacts_birthday_in_5_days', name: 'Contacts Birthday in 5 Days', description: 'Contacts whose birthday falls within the next 5 days' },
  { key: 'converted_leads', name: 'Converted Leads', description: 'Leads that were converted into deals' },
  { key: 'deals_completed_30_days_ago', name: 'Deals Completed 30 Days Ago', description: 'Contacts whose deals closed within the last 30 days' },
  { key: 'leads_in_progress', name: 'Leads in Progress', description: 'Leads in an active pipeline stage' },
  { key: 'leads_birthday_in_5_days', name: 'Leads Birthday in 5 Days', description: 'Leads whose birthday falls within the next 5 days' },
  { key: 'christmas_sale', name: 'Christmas Sale', description: 'Marketing segment — falls back to All Clients and Leads' },
  { key: 'halloween_sale', name: 'Halloween Sale', description: 'Marketing segment — falls back to All Clients and Leads' },
  { key: 'thanksgiving_sale', name: 'Thanksgiving Sale', description: 'Marketing segment — falls back to All Clients and Leads' },
  { key: 'valentine_day_sale', name: 'Valentine Day Sale', description: 'Marketing segment — falls back to All Clients and Leads' },
]);

const SALE_SEGMENTS = new Set(['christmas_sale', 'halloween_sale', 'thanksgiving_sale', 'valentine_day_sale']);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves Bitrix24 audience segments into recipient phone numbers.
 *
 * Bitrix24 list methods cap responses at 50 rows, so every resolver pages
 * through the full result set (see `_safeList`). Deal-based segments are
 * resolved in two hops: fetch the deals, collect their CONTACT_IDs, then
 * pull the contacts.
 */
class SegmentResolverService {
  constructor({ bitrix24 = new Bitrix24Service() } = {}) {
    this.bitrix24 = bitrix24;
  }

  listSegments() {
    return CAMPAIGN_SEGMENTS;
  }

  findSegment(key) {
    return CAMPAIGN_SEGMENTS.find((s) => s.key === key) || null;
  }

  /**
   * Resolves the segment audience to normalized phone entries.
   * Returns [{ phone, name, contactId }]; never throws for a known key —
   * an empty segment is a valid audience (logged).
   */
  async resolve(key, tenantId = null) {
    if (!key) return [];
    if (SALE_SEGMENTS.has(key)) {
      log.info('sale segment falls back to all clients and leads', { key });
      return this._allClientsAndLeads(tenantId);
    }

    switch (key) {
      case 'all_clients':
        return this._allContacts(tenantId);
      case 'all_leads':
        return this._allLeads({}, tenantId);
      case 'all_clients_and_leads':
        return this._allClientsAndLeads(tenantId);
      case 'active_deals_in_progress':
        return this._contactsWithDeals({ filter: { CLOSED: 'N', STAGE_SEMANTIC_ID: 'P' } }, tenantId);
      case 'clients_with_lost_deals':
        return this._contactsWithDeals({ filter: { STAGE_SEMANTIC_ID: 'F' } }, tenantId);
      case 'clients_with_won_deals':
        return this._contactsWithDeals({ filter: { STAGE_SEMANTIC_ID: 'S' } }, tenantId);
      case 'deals_completed_30_days_ago': {
        const from = new Date(Date.now() - 30 * DAY_MS);
        return this._contactsWithDeals({ filter: { CLOSED: 'Y', '>=DATE_CLOSE': from, '<=DATE_CLOSE': new Date() } }, tenantId);
      }
      case 'contacts_birthday_in_5_days':
        return this._birthdayContacts(tenantId);
      case 'leads_in_progress':
        return this._allLeads({ filter: { STATUS_SEMANTIC_ID: 'P' } }, tenantId);
      case 'leads_birthday_in_5_days':
        return this._birthdayLeads(tenantId);
      case 'converted_leads':
        return this._convertedLeads(tenantId);
      default:
        log.warn('unknown segment key', { key });
        return [];
    }
  }

  async segmentLabel(key) {
    const segment = this.findSegment(key);
    return segment ? segment.name : null;
  }

  // ---------------- Resolvers ----------------

  async _allContacts(tenantId) {
    return this._listContacts({}, tenantId);
  }

  async _allLeads(extra = {}, tenantId) {
    const params = {
      filter: extra.filter || {},
      select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'CONTACT_ID'],
      start: -1,
    };
    const rows = await this._safeList(BITRIX24_METHODS.LEAD_LIST, params, tenantId);
    return rows.map((r) => this._leadEntry(r)).filter((e) => e.phone);
  }

  async _allClientsAndLeads(tenantId) {
    const [contacts, leads] = await Promise.all([
      this._allContacts(tenantId),
      this._allLeads({}, tenantId),
    ]);
    return this._dedupe([...contacts, ...leads]);
  }

  async _contactsWithDeals({ filter }, tenantId) {
    const deals = await this._safeList(
      BITRIX24_METHODS.DEAL_LIST,
      { filter, select: ['ID', 'CONTACT_ID'], start: -1 },
      tenantId
    );
    const contactIds = [...new Set(deals.map((d) => d.CONTACT_ID).filter(Boolean))];
    if (!contactIds.length) return [];

    const contacts = [];
    for (let i = 0; i < contactIds.length; i += 50) {
      const chunk = contactIds.slice(i, i + 50);
      const rows = await this._safeList(
        BITRIX24_METHODS.CONTACT_LIST,
        { filter: { ID: chunk.join(',') }, select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'], start: -1 },
        tenantId
      );
      contacts.push(...rows);
    }
    return contacts.map((c) => this._contactEntry(c)).filter((e) => e.phone);
  }

  async _convertedLeads(tenantId) {
    const leads = await this._safeList(
      BITRIX24_METHODS.LEAD_LIST,
      { filter: { STATUS_ID: 'CONVERTED' }, select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'CONTACT_ID'], start: -1 },
      tenantId
    );
    const entries = leads.map((r) => this._leadEntry(r)).filter((e) => e.phone);
    const contactIds = leads.map((l) => l.CONTACT_ID).filter(Boolean);
    if (contactIds.length) {
      const withContacts = [];
      for (let i = 0; i < contactIds.length; i += 50) {
        const chunk = contactIds.slice(i, i + 50);
        const rows = await this._safeList(
          BITRIX24_METHODS.CONTACT_LIST,
          { filter: { ID: chunk.join(',') }, select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'], start: -1 },
          tenantId
        );
        withContacts.push(...rows.map((c) => this._contactEntry(c)).filter((e) => e.phone));
      }
      return this._dedupe([...entries, ...withContacts]);
    }
    return entries;
  }

  async _birthdayContacts(tenantId) {
    const rows = await this._safeList(
      BITRIX24_METHODS.CONTACT_LIST,
      { select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'BIRTHDATE'], start: -1 },
      tenantId
    );
    return rows
      .map((c) => this._contactEntry(c))
      .filter((e) => e.phone && this._isBirthdaySoon(e._BIRTHDATE));
  }

  async _birthdayLeads(tenantId) {
    const rows = await this._safeList(
      BITRIX24_METHODS.LEAD_LIST,
      { select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'BIRTHDATE', 'CONTACT_ID'], start: -1 },
      tenantId
    );
    return rows
      .map((r) => this._leadEntry(r))
      .filter((e) => e.phone && this._isBirthdaySoon(e._BIRTHDATE));
  }

  // ---------------- Helpers ----------------

  async _listContacts(filter, tenantId) {
    const rows = await this._safeList(
      BITRIX24_METHODS.CONTACT_LIST,
      { filter, select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'], start: -1 },
      tenantId
    );
    return this._dedupe(rows.map((c) => this._contactEntry(c)).filter((e) => e.phone));
  }

  /**
   * Bitrix24 list methods cap responses at 50 rows per page and ignore
   * `start: -1`, so this pages through with offsets until a short page
   * signals the end. A failure on the first page usually means a broken
   * filter (B24 returns HTTP-200-with-error bodies for list calls too):
   * it is treated as an empty audience so a bad filter cannot crash a
   * campaign launch. A failure on any later page means the result set
   * would be silently truncated — for a marketing audience that must not
   * happen, so the error is propagated instead of sending to a partial
   * list.
   */
  async _safeList(method, params, tenantId) {
    const PAGE_SIZE = 50;
    const all = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let page;
      try {
        page = await this.bitrix24.call(method, { ...params, start: offset }, { retries: 2 });
      } catch (err) {
        if (offset === 0) {
          log.warn('segment list first page failed; treating as empty audience', {
            method,
            key: params.filter,
            code: err.code,
            message: err.message,
          });
          return all;
        }
        log.error('segment list pagination failed; aborting resolve to avoid a partial audience', {
          method,
          key: params.filter,
          offset,
          collected: all.length,
          code: err.code,
          message: err.message,
        });
        throw err;
      }
      if (!Array.isArray(page)) {
        if (offset === 0) return all;
        throw new Error(`Segment list method ${method} returned an unexpected payload at offset ${offset}`);
      }
      all.push(...page);
      if (page.length < PAGE_SIZE) return all;
    }
  }

  _contactEntry(c) {
    const phone = this._firstPhone(c.PHONE);
    return {
      phone,
      name: c.NAME || c.LAST_NAME ? [c.NAME, c.LAST_NAME].filter(Boolean).join(' ') : null,
      contactId: c.ID ? Number(c.ID) : null,
      _BIRTHDATE: c.BIRTHDATE || null,
    };
  }

  _leadEntry(l) {
    const phone = this._firstPhone(l.PHONE);
    return {
      phone,
      name: l.NAME || l.LAST_NAME ? [l.NAME, l.LAST_NAME].filter(Boolean).join(' ') : null,
      contactId: l.CONTACT_ID ? Number(l.CONTACT_ID) : null,
      _BIRTHDATE: l.BIRTHDATE || null,
    };
  }

  _firstPhone(phones) {
    if (!Array.isArray(phones) || !phones.length) return null;
    const value = phones[0] && phones[0].VALUE;
    return value ? normalizePhone(value) : null;
  }

  _dedupe(entries) {
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
      if (!entry.phone || seen.has(entry.phone)) continue;
      seen.add(entry.phone);
      out.push(entry);
    }
    return out;
  }

  /**
   * True when the anniversary of `birthdate` falls within the next 5 days
   * (including today). Compares month/day only.
   */
  _isBirthdaySoon(rawBirthdate) {
    if (rawBirthdate) {
      const parsed = new Date(rawBirthdate);
      if (!Number.isNaN(parsed.getTime())) return this._withinFiveDays(parsed);
    }
    return false;
  }

  _withinFiveDays(date) {
    const now = new Date();
    const candidate = new Date(now.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((candidate - now) / DAY_MS);
    if (diffDays >= 0 && diffDays <= 5) return true;

    // Birthday already passed this year — check the next year's anniversary.
    const nextYear = new Date(now.getFullYear() + 1, date.getMonth(), date.getDate());
    return Math.round((nextYear - now) / DAY_MS) <= 5;
  }
}

module.exports = { SegmentResolverService, CAMPAIGN_SEGMENTS, CAMPAIGN_B24_SOURCE_ID };
