const { z } = require('zod');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { env } = require('../config');
const { normalizePhone } = require('../helpers/phone');
const { CampaignRepository, CAMPAIGN_STATUS, RECIPIENT_STATUS } = require('../repositories/campaign.repository');
const { WhatsBoxService } = require('./whatsbox');
const { OutgoingMessageService } = require('./outgoingMessage.service');
const { SegmentResolverService } = require('./segmentResolver.service');
const { Bitrix24Service } = require('./bitrix24');

const log = logger.childFor('campaign-service');

const createSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['TEXT', 'MEDIA']).default('TEXT'),
  body: z.string().max(4096).optional(),
  mediaUrl: z.string().url('mediaUrl must be a valid public URL').optional(),
  caption: z.string().max(1000).optional(),
  recipients: z.array(z.string()).optional(),
  segmentId: z.string().max(100).optional(),
  segmentName: z.string().max(255).optional(),
  createdVia: z.enum(['WHATSAPP', 'BITRIX24']).default('WHATSAPP'),
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
 * A campaign stores a message (text or media) and an audience. The
 * audience is either an explicit list of phone numbers or a Bitrix24
 * segment resolved at launch time (see SegmentResolverService). `execute`
 * sends to every pending recipient through the same find-or-create +
 * persist pipeline as operator messages, so each recipient gets its own
 * conversation + Bitrix24 lead (deduped) and every send is recorded as a
 * Message with the campaignId attached. That gives replies a stable
 * thread to land in and lets the shared retry job re-send failures.
 */
class CampaignService {
  constructor({
    repo = new CampaignRepository(),
    whatsbox = new WhatsBoxService(),
    segmentResolver = new SegmentResolverService(),
    bitrix24 = new Bitrix24Service(),
    outgoingMessageService = null,
  } = {}) {
    this.repo = repo;
    this.whatsbox = whatsbox;
    this.segmentResolver = segmentResolver;
    this.bitrix24 = bitrix24;
    this.outgoingMessageService =
      outgoingMessageService || new OutgoingMessageService({ whatsbox });
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
    const segment = this._resolveSegment(data);

    const campaign = await this.repo.create({
      tenantId: tenantId ? Number(tenantId) : null,
      name: data.name,
      type: data.type,
      body: data.body || null,
      mediaUrl: data.mediaUrl || null,
      caption: data.caption || null,
      createdVia: data.createdVia,
      status: CAMPAIGN_STATUS.DRAFT,
      segmentKey: segment ? segment.key : null,
      segmentName: segment ? segment.name : null,
      totalRecipients: phones.length,
    });

    if (phones.length) await this.repo.addRecipients(campaign.id, phones);

    // WhatsApp-side campaigns are mirrored into Bitrix24 as a lead so the
    // campaign is visible in the CRM. Best-effort: a Bitrix24 failure must
    // never block the campaign creation.
    if (data.createdVia === 'WHATSAPP') {
      try {
        const bitrix24LeadId = Number(
          await this.bitrix24.createCampaignLead({
            name: data.name,
            body: data.body || null,
            segmentName: segment ? segment.name : null,
            tenantId: tenantId ? Number(tenantId) : null,
          })
        );
        if (bitrix24LeadId) {
          await this.repo.update(campaign.id, { bitrix24LeadId });
        }
      } catch (err) {
        log.warn('campaign push to Bitrix24 failed; campaign stays local', {
          campaignId: campaign.id,
          code: err.code,
          message: err.message,
        });
      }
    }

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
    if (data.segmentId !== undefined) {
      const segment = this._resolveSegment(data);
      patch.segmentKey = segment ? segment.key : null;
      patch.segmentName = segment ? segment.name : null;
    }
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

  listSegments() {
    return this.segmentResolver.listSegments();
  }

  /**
   * Sends the campaign to all PENDING recipients. When the campaign
   * targets a Bitrix24 segment, the audience is resolved live and any
   * explicit recipients passed here are added on top. Sends go through
   * OutgoingMessageService so each recipient is persisted as a Message +
   * conversation + (deduped) lead; failures are recorded per recipient
   * and re-tried by the retry job.
   */
  async execute(id, { recipients = [], segmentId = null, tenantId = null } = {}) {
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

    // A segment chosen at launch time is bound to the campaign now.
    let segmentKey = campaign.segmentKey;
    if (segmentId) {
      const segment = this.segmentResolver.findSegment(segmentId);
      if (!segment) {
        throw new AppError(`Unknown segment: ${segmentId}`, 400, null, 'UNKNOWN_SEGMENT');
      }
      segmentKey = segment.key;
      await this.repo.update(id, { segmentKey: segment.key, segmentName: segment.name });
    }

    // Resolve the audience: segment members (live) + explicit numbers.
    const segmentEntries = segmentKey
      ? await this.segmentResolver.resolve(segmentKey, tenantId)
      : [];
    const nameByPhone = new Map();
    for (const entry of segmentEntries) nameByPhone.set(entry.phone, entry.name);

    const explicit = this._normalizePhones(recipients);
    let audience = [...new Set([...segmentEntries.map((e) => e.phone).filter(Boolean), ...explicit])];
    if (!audience.length) {
      // Fall back to recipients already stored on the campaign (e.g. a
      // campaign mirrored from a Bitrix24 lead that carried its own phone).
      const stored = await this.repo.listPendingRecipients(id);
      audience = stored.map((r) => r.phone);
    }
    if (!audience.length) {
      throw new AppError(
        segmentKey
          ? 'Campaign segment has no members to send to.'
          : 'Campaign has no recipients. Add phone numbers or a segment.',
        400,
        null,
        'CAMPAIGN_NO_RECIPIENTS'
      );
    }

    // Merge the audience into recipient rows (idempotent per phone).
    await this.repo.addRecipients(id, audience);
    const finalPending = await this.repo.listPendingRecipients(id);
    if (!finalPending.length) {
      throw new AppError('Campaign has no recipients to send to.', 400, null, 'CAMPAIGN_NO_RECIPIENTS');
    }

    await this.repo.setStatus(id, CAMPAIGN_STATUS.PROCESSING, { startedAt: new Date(), error: null });
    await this.repo.update(id, { totalRecipients: finalPending.length });

    const channelId = env.WHATSBOX_CHANNEL_ID || undefined;
    const sendInput = {
      channelId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      tenantId: tenantId ? Number(tenantId) : null,
    };

    let sent = 0;
    let failed = 0;

    for (const recipient of finalPending) {
      const input = {
        ...sendInput,
        to: recipient.phone,
        name: nameByPhone.get(recipient.phone) || undefined,
      };
      try {
        const message =
          campaign.type === 'MEDIA'
            ? await this.outgoingMessageService.sendMedia({
                ...input,
                type: this._mediaType(campaign),
                link: campaign.mediaUrl,
                caption: campaign.caption || undefined,
                filename: campaign.mediaName || undefined,
              })
            : await this.outgoingMessageService.sendText({ ...input, body: campaign.body });

        await this.repo.updateRecipientStatus(recipient.id, {
          status: RECIPIENT_STATUS.SENT,
          sentAt: new Date(),
          messageId: message ? message.id : null,
          whatsappMessageId: message ? message.whatsboxMessageId : null,
          contactId: message ? message.contactId : null,
          conversationId: message ? message.conversationId : null,
          leadId: message ? message.leadId : null,
        });
        sent += 1;
      } catch (err) {
        log.warn('campaign recipient send failed', {
          campaignId: id,
          phone: recipient.phone,
          code: err.code,
          message: err.message,
        });
        await this.repo.updateRecipientStatus(recipient.id, {
          status: RECIPIENT_STATUS.FAILED,
          error: err.message,
        });
        failed += 1;
      }
    }

    await this.repo.syncCounters(id);

    const status =
      failed === 0
        ? CAMPAIGN_STATUS.COMPLETED
        : sent === 0
          ? CAMPAIGN_STATUS.FAILED
          : CAMPAIGN_STATUS.PARTIAL;

    await this.repo.setStatus(id, status, { completedAt: new Date(), error: null });

    log.info('campaign executed', { campaignId: id, status, sent, failed, segmentKey });
    return this.get(id, tenantId);
  }

  /**
   * Resolves a segment key to the catalog entry (validating the key and
   * normalizing the label). Returns null when no segment is requested.
   */
  _resolveSegment(data) {
    if (!data.segmentId) return null;
    const segment = this.segmentResolver.findSegment(data.segmentId);
    if (!segment) {
      throw new AppError(`Unknown segment: ${data.segmentId}`, 400, null, 'UNKNOWN_SEGMENT');
    }
    return { key: segment.key, name: data.segmentName || segment.name };
  }
}

module.exports = { CampaignService, CAMPAIGN_STATUS };
