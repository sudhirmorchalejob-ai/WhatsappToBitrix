const logger = require('../../../utils/logger');
const { BITRIX24_METHODS, CAMPAIGN_B24_LEAD_PREFIX } = require('../../../constants');
const { CampaignRepository, CAMPAIGN_STATUS } = require('../../../repositories/campaign.repository');
const { Bitrix24Service } = require('../../../services/bitrix24');
const { CAMPAIGN_SEGMENTS } = require('../../../services/segmentResolver.service');
const { normalizePhone } = require('../../../helpers/phone');

const log = logger.childFor('webhook-b24-lead');

/**
 * Segment selection carried on the Bitrix24 campaign lead's comments.
 * The first line `Segment: <name>` picks the audience; the rest of the
 * comments is the campaign message. `<name>` can be any label from the
 * segment catalog (e.g. "All Clients", "All Leads", "Contacts Birthday in
 * 5 Days") or the raw segment key.
 */
const SEGMENT_MARKER = /^segment\s*:\s*(.+)$/i;

/** Loose normalizer: lowercase, collapse whitespace, "five"->"5", drop trailing "s". */
function normalizeSegmentName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\bfive\b/g, '5')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.replace(/s$/, ''))
    .join(' ');
}

/**
 * Builds a lookup from any segment alias (label or key) to its key, so a
 * segment picked in the Bitrix24 "segment" section maps to the same
 * audience the WhatsApp side uses.
 */
const SEGMENT_ALIASES = (() => {
  const map = new Map();
  for (const segment of CAMPAIGN_SEGMENTS) {
    map.set(normalizeSegmentName(segment.key), segment.key);
    map.set(normalizeSegmentName(segment.name), segment.key);
  }
  return map;
})();

/**
 * Bitrix24 -> WhatsApp campaign sync.
 *
 * Bitrix24 fires ONCRMLEADADD whenever a lead is created in the portal
 * (including via REST webhook calls). When the lead's title carries the
 * campaign marker (CAMPAIGN_B24_LEAD_PREFIX), this handler mirrors it into
 * a local campaign (createdVia = BITRIX24) linked back by bitrix24LeadId.
 * Leads without the marker are ignored, so ordinary CRM leads never become
 * WhatsApp campaigns.
 *
 * Idempotent: a second delivery for the same lead is a no-op because the
 * local campaign is keyed by bitrix24LeadId. Every B24 side-effect is
 * defensive so the webhook acknowledgement never fails.
 */
class LeadAddedHandler {
  constructor({
    campaignRepository = new CampaignRepository(),
    bitrix24 = new Bitrix24Service(),
  } = {}) {
    this.campaignRepository = campaignRepository;
    this.bitrix24 = bitrix24;
  }

  _campaignNameFromTitle(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();
    if (!trimmed.startsWith(CAMPAIGN_B24_LEAD_PREFIX)) return null;
    const name = trimmed.slice(CAMPAIGN_B24_LEAD_PREFIX.length).trim();
    return name || null;
  }

  _phonesFromLead(lead) {
    const phones = Array.isArray(lead.PHONE) ? lead.PHONE : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of phones) {
      if (!entry || entry.VALUE === undefined || entry.VALUE === null) continue;
      const phone = normalizePhone(String(entry.VALUE));
      if (phone && !seen.has(phone)) {
        seen.add(phone);
        normalized.push(phone);
      }
    }
    return normalized;
  }

  /**
   * Splits the lead comments into an optional `Segment: <name>` header and
   * the campaign message body. Returns { segment: {key,name}|null, body }.
   */
  _parseComments(comments) {
    if (!comments || typeof comments !== 'string') return { segment: null, body: null };
    const lines = comments.split(/\r?\n/);
    const first = (lines[0] || '').trim();
    const match = first.match(SEGMENT_MARKER);
    if (!match) return { segment: null, body: comments.trim() || null };

    const key = SEGMENT_ALIASES.get(normalizeSegmentName(match[1]));
    if (!key) return { segment: null, body: comments.trim() || null };

    const segment = CAMPAIGN_SEGMENTS.find((s) => s.key === key);
    const body = lines.slice(1).join('\n').trim() || null;
    return { segment: segment || null, body };
  }

  async handle(canonical, { install, auth } = {}) {
    if (!canonical || canonical.event !== 'leadAdded') {
      return { handled: false, skipped: true, reason: 'not-lead-event' };
    }

    const leadId = canonical.leadId;
    if (!leadId) {
      return { handled: true, skipped: true, reason: 'no-lead-id' };
    }

    const memberId = (install && install.memberId) || canonical.memberId || null;
    const tenantId = install && install.tenantId ? Number(install.tenantId) : null;

    // Dedup first: a campaign already mirrored for this lead is a no-op.
    const existing = await this.campaignRepository.findByBitrix24LeadId(leadId, tenantId);
    if (existing) {
      return { handled: true, skipped: true, reason: 'duplicate', campaignId: existing.id };
    }

    // Fetch the lead so we can inspect its title/body. Prefer the webhook
    // client (works for webhook-only installs), fall back to the app OAuth
    // client for portals where only the app context can read.
    let lead;
    try {
      lead = await this.bitrix24.getLead(leadId, tenantId);
    } catch (err) {
      log.info('webhook lead fetch failed, trying app context', { leadId, code: err.code, message: err.message });
      try {
        if (memberId) {
          this.bitrix24.activate(memberId);
          lead = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.LEAD_GET, { id: leadId });
        }
      } catch (appErr) {
        log.warn('lead fetch failed for campaign sync', { leadId, code: appErr.code, message: appErr.message });
        return { handled: true, skipped: true, reason: 'lead-fetch-failed', error: appErr.message };
      }
    }

    if (!lead || !lead.TITLE) {
      return { handled: true, skipped: true, reason: 'lead-empty' };
    }

    const name = this._campaignNameFromTitle(lead.TITLE);
    if (!name) {
      return { handled: true, skipped: true, reason: 'not-campaign-lead' };
    }

    const { segment, body } = this._parseComments(lead.COMMENTS);

    // A chosen segment is the audience source of truth; the campaign body
    // is the remaining comments. Without a segment, fall back to the phone
    // number(s) carried directly on the lead.
    const phones = segment ? [] : this._phonesFromLead(lead);
    const campaign = await this.campaignRepository.create({
      tenantId,
      name,
      type: 'TEXT',
      body,
      createdVia: 'BITRIX24',
      status: CAMPAIGN_STATUS.DRAFT,
      segmentKey: segment ? segment.key : null,
      segmentName: segment ? segment.name : null,
      bitrix24LeadId: Number(leadId),
      totalRecipients: phones.length,
    });

    if (phones.length) {
      await this.campaignRepository.addRecipients(campaign.id, phones);
    }

    log.info('campaign mirrored from Bitrix24 lead', {
      campaignId: campaign.id,
      leadId,
      tenantId,
      name,
      segmentKey: segment ? segment.key : null,
      recipients: phones.length,
    });

    return { handled: true, campaignId: campaign.id };
  }
}

module.exports = { LeadAddedHandler };
