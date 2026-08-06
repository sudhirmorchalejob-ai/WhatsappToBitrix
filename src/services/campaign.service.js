const { z } = require('zod');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { normalizePhone } = require('../helpers/phone');
const { CampaignRepository, CAMPAIGN_STATUS } = require('../repositories/campaign.repository');
const { WhatsBoxService } = require('./whatsbox');

const log = logger.childFor('campaign-service');

const createSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['TEXT', 'MEDIA']).default('TEXT'),
  body: z.string().max(4096).optional(),
  mediaUrl: z.string().url('mediaUrl must be a valid public URL').optional(),
  caption: z.string().max(1000).optional(),
  recipients: z.array(z.string()).optional(),
});

const MEDIA_EXT_TO_TYPE = Object.freeze({
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mp3: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  wav: 'audio',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  csv: 'document',
  txt: 'document',
});

/**
 * WhatsApp marketing campaigns.
 *
 * A campaign stores a message (text or media) and an audience of phone
 * numbers. `execute` sends to every pending recipient through the shared
 * WhatsBox provider and tracks per-recipient + campaign-level counters.
 * Campaigns are created, managed and launched from the Bitrix24 sidebar
 * app (or the standalone dashboard).
 */
class CampaignService {
  constructor({ repo = new CampaignRepository(), whatsbox = new WhatsBoxService() } = {}) {
    this.repo = repo;
    this.whatsbox = whatsbox;
  }

  _normalizePhones(list = []) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((p) => normalizePhone(p)).filter(Boolean))];
  }

  _mediaType(campaign) {
    const url = String(campaign.mediaUrl || '');
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    return MEDIA_EXT_TO_TYPE[ext] || 'document';
  }

  async create(input, tenantId = null) {
    const data = createSchema.parse(input);
    const phones = this._normalizePhones(data.recipients);

    const campaign = await this.repo.create({
      tenantId: tenantId ? Number(tenantId) : null,
      name: data.name,
      type: data.type,
      body: data.body || null,
      mediaUrl: data.mediaUrl || null,
      caption: data.caption || null,
      createdVia: 'BITRIX24',
      status: CAMPAIGN_STATUS.DRAFT,
      totalRecipients: phones.length,
    });

    if (phones.length) await this.repo.addRecipients(campaign.id, phones);
    return this.repo.findById(campaign.id, tenantId);
  }

  async list(query = {}, tenantId = null) {
    return this.repo.list({
      tenantId,
      status: query.status || null,
      search: query.search || null,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
  }

  async get(id, tenantId = null) {
    const campaign = await this.repo.findById(id, tenantId);
    if (!campaign) throw new AppError('Campaign not found', 404, null, 'CAMPAIGN_NOT_FOUND');
    const recipients = await this.repo.listRecipients(id);
    return { ...campaign, recipients };
  }

  async update(id, input, tenantId = null) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new AppError('Campaign not found', 404, null, 'CAMPAIGN_NOT_FOUND');
    if (existing.status === CAMPAIGN_STATUS.PROCESSING) {
      throw new AppError('Campaign is processing and cannot be edited', 409, null, 'CAMPAIGN_PROCESSING');
    }

    const data = createSchema.partial().parse(input || {});
    const patch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.type !== undefined) patch.type = data.type;
    if (data.body !== undefined) patch.body = data.body;
    if (data.mediaUrl !== undefined) patch.mediaUrl = data.mediaUrl;
    if (data.caption !== undefined) patch.caption = data.caption;
    if (Object.keys(patch).length) await this.repo.update(id, patch);

    if (data.recipients !== undefined) {
      const phones = this._normalizePhones(data.recipients);
      if (phones.length) await this.repo.addRecipients(id, phones);
      const counts = await this.repo.recipientCounts(id);
      await this.repo.update(id, {
        totalRecipients: Object.values(counts).reduce((a, b) => a + b, 0),
      });
    }

    return this.get(id, tenantId);
  }

  async delete(id, tenantId = null) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new AppError('Campaign not found', 404, null, 'CAMPAIGN_NOT_FOUND');
    if (existing.status === CAMPAIGN_STATUS.PROCESSING) {
      throw new AppError('Campaign is processing and cannot be deleted', 409, null, 'CAMPAIGN_PROCESSING');
    }
    await this.repo.delete(id);
    return true;
  }

  /**
   * Sends the campaign to all PENDING recipients (any recipients passed
   * here are added first). Completes with COMPLETED / PARTIAL / FAILED
   * depending on how many sends succeeded.
   */
  async execute(id, { recipients = [], tenantId = null } = {}) {
    const campaign = await this.repo.findById(id, tenantId);
    if (!campaign) throw new AppError('Campaign not found', 404, null, 'CAMPAIGN_NOT_FOUND');
    if (campaign.status === CAMPAIGN_STATUS.PROCESSING) {
      throw new AppError('Campaign is already processing', 409, null, 'CAMPAIGN_PROCESSING');
    }
    if (campaign.type === 'TEXT' && !campaign.body) {
      throw new AppError('Text campaign has no message body', 400, null, 'CAMPAIGN_NO_BODY');
    }
    if (campaign.type === 'MEDIA' && !campaign.mediaUrl) {
      throw new AppError('Media campaign has no media URL', 400, null, 'CAMPAIGN_NO_MEDIA');
    }

    const phones = this._normalizePhones(recipients);
    if (phones.length) await this.repo.addRecipients(id, phones);

    const pending = await this.repo.listPendingRecipients(id);
    if (!pending.length) {
      throw new AppError('Campaign has no recipients. Add phone numbers first.', 400, null, 'CAMPAIGN_NO_RECIPIENTS');
    }

    await this.repo.setStatus(id, CAMPAIGN_STATUS.PROCESSING, { startedAt: new Date(), error: null });
    await this.repo.update(id, { totalRecipients: pending.length });

    let sent = 0;
    let failed = 0;

    for (const recipient of pending) {
      try {
        const result =
          campaign.type === 'MEDIA'
            ? await this.whatsbox.sendMedia({
                to: recipient.phone,
                type: this._mediaType(campaign),
                link: campaign.mediaUrl,
                caption: campaign.caption || undefined,
              })
            : await this.whatsbox.sendText({ to: recipient.phone, body: campaign.body });

        await this.repo.updateRecipientStatus(recipient.id, { status: 'SENT', sentAt: new Date() });
        sent += 1;
      } catch (err) {
        log.warn('campaign recipient send failed', {
          campaignId: id,
          phone: recipient.phone,
          code: err.code,
          message: err.message,
        });
        await this.repo.updateRecipientStatus(recipient.id, {
          status: 'FAILED',
          error: err.message,
        });
        failed += 1;
      }
    }

    const status =
      failed === 0
        ? CAMPAIGN_STATUS.COMPLETED
        : sent === 0
          ? CAMPAIGN_STATUS.FAILED
          : CAMPAIGN_STATUS.PARTIAL;

    await this.repo.updateCounters(id, {
      totalRecipients: pending.length,
      sentCount: sent,
      deliveredCount: 0,
      failedCount: failed,
      error: null,
    });
    await this.repo.setStatus(id, status, { completedAt: new Date() });

    log.info('campaign executed', { campaignId: id, status, sent, failed });
    return this.get(id, tenantId);
  }
}

module.exports = { CampaignService, CAMPAIGN_STATUS };
