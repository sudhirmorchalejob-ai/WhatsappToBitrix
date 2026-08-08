const { Prisma } = require('@prisma/client');
const prismaClient = require('../database/prisma');

const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
});

const RECIPIENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
});

/**
 * Campaigns CRUD + recipient rows.
 *
 * Recipients live in the `campaign_recipients` table and are accessed
 * through raw SQL because the Prisma client is generated from the schema
 * on the deploy machine; keeping this in raw queries avoids requiring a
 * client regeneration to ship the feature.
 */
class CampaignRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id, tenantId = null) {
    if (!id) return null;
    return this.prisma.campaign.findFirst({
      where: {
        id: Number(id),
        ...(tenantId ? { tenantId: Number(tenantId) } : {}),
      },
      include: { _count: { select: { messages: true } } },
    });
  }

  async create(data) {
    return this.prisma.campaign.create({ data });
  }

  async update(id, data) {
    return this.prisma.campaign.update({ where: { id: Number(id) }, data });
  }

  async findByBitrix24LeadId(bitrix24LeadId, tenantId = null) {
    if (!bitrix24LeadId) return null;
    return this.prisma.campaign.findFirst({
      where: {
        bitrix24LeadId: Number(bitrix24LeadId),
        ...(tenantId ? { tenantId: Number(tenantId) } : {}),
      },
    });
  }

  async delete(id) {
    return this.prisma.campaign.delete({ where: { id: Number(id) } });
  }

  async list({ tenantId = null, status = null, search = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (tenantId) where.tenantId = Number(tenantId);
    if (status) where.status = status;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, total };
  }

  async setStatus(id, status, extra = {}) {
    return this.prisma.campaign.update({ where: { id: Number(id) }, data: { status, ...extra } });
  }

  async updateCounters(id, { totalRecipients, sentCount, deliveredCount, failedCount, error = null }) {
    return this.prisma.campaign.update({
      where: { id: Number(id) },
      data: {
        totalRecipients,
        sentCount,
        deliveredCount,
        failedCount,
        error,
      },
    });
  }

  async incrementReplyCount(id) {
    return this.prisma.campaign.update({
      where: { id: Number(id) },
      data: { replyCount: { increment: 1 } },
    });
  }

  // ---------------- Recipients (raw SQL) ----------------

  async addRecipients(campaignId, phones) {
    const unique = [...new Set(phones.map((p) => String(p).trim()).filter(Boolean))];
    if (!unique.length) return 0;

    const rows = unique.map((phone) => Prisma.sql`(${Number(campaignId)}, ${phone}, NOW())`);
    const res = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "campaign_recipients" ("campaignId", "phone", "createdAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("campaignId", "phone") DO NOTHING
    `);
    return Number(res || 0);
  }

  async listRecipients(campaignId) {
    return this.prisma.$queryRaw`
      SELECT
        id,
        "campaignId" AS "campaignId",
        phone,
        status,
        error,
        attempts,
        "contactId" AS "contactId",
        "conversationId" AS "conversationId",
        "leadId" AS "leadId",
        "messageId" AS "messageId",
        "whatsappMessageId" AS "whatsappMessageId",
        "sentAt" AS "sentAt",
        "deliveredAt" AS "deliveredAt",
        "readAt" AS "readAt",
        "repliedAt" AS "repliedAt",
        "createdAt" AS "createdAt"
      FROM "campaign_recipients"
      WHERE "campaignId" = ${Number(campaignId)}
      ORDER BY id ASC
    `;
  }

  async listPendingRecipients(campaignId) {
    return this.prisma.$queryRaw`
      SELECT id, phone
      FROM "campaign_recipients"
      WHERE "campaignId" = ${Number(campaignId)} AND status = 'PENDING'
      ORDER BY id ASC
    `;
  }

  async updateRecipientStatus(id, { status, error = null, sentAt = null, attempts = null, messageId = null, whatsappMessageId = null, contactId = null, conversationId = null, leadId = null }) {
    const attemptsSet = attempts !== null && attempts !== undefined ? Prisma.sql`"attempts" = ${Number(attempts)},` : Prisma.sql``;
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET status = ${status},
          error = ${error},
          "sentAt" = ${sentAt},
          ${attemptsSet}
          "messageId" = COALESCE(${messageId}, "messageId"),
          "whatsappMessageId" = COALESCE(${whatsappMessageId}, "whatsappMessageId"),
          "contactId" = COALESCE(${contactId}, "contactId"),
          "conversationId" = COALESCE(${conversationId}, "conversationId"),
          "leadId" = COALESCE(${leadId}, "leadId")
      WHERE id = ${Number(id)}
    `;
  }

  /**
   * Delivery/read callbacks arrive with the provider message id. Store the
   * timestamp on the recipient only when not already recorded, so counters
   * recomputed from these columns stay idempotent.
   */
  async markDeliveredByMessageId(messageId, at = new Date()) {
    if (!messageId) return 0;
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET "deliveredAt" = COALESCE("deliveredAt", ${at})
      WHERE "messageId" = ${Number(messageId)}
    `;
  }

  async markReadByMessageId(messageId, at = new Date()) {
    if (!messageId) return 0;
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET "readAt" = COALESCE("readAt", ${at})
      WHERE "messageId" = ${Number(messageId)}
    `;
  }

  /**
   * Syncs recipient delivery state after a provider (re)send: the message
   * is the source of truth, the recipient row mirrors it. Used by the
   * retry job when a campaign message is successfully re-sent.
   */
  async updateRecipientFromMessage(messageId, { status, error = null, sentAt = null }) {
    if (!messageId) return 0;
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET status = ${status},
          error = ${error},
          "sentAt" = ${sentAt}
      WHERE "messageId" = ${Number(messageId)}
    `;
  }

  async markReplied(id, at = new Date()) {
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET "repliedAt" = ${at}
      WHERE id = ${Number(id)}
    `;
  }

  /**
   * Finds the best campaign-recipient match for an inbound reply: the
   * recipient of the most recent campaign (PROCESSING/COMPLETED/PARTIAL)
   * who has not replied yet, scoped to the tenant when one is given.
   */
  async findActiveRecipientByPhone(phone, tenantId = null) {
    if (!phone) return null;
    const rows = await this.prisma.$queryRaw`
      SELECT
        r.id,
        r."campaignId" AS "campaignId",
        r.phone,
        r."conversationId" AS "conversationId",
        r."contactId" AS "contactId",
        r."repliedAt" AS "repliedAt",
        c.name AS "campaignName",
        c.status AS "campaignStatus"
      FROM "campaign_recipients" r
      JOIN "campaigns" c ON c.id = r."campaignId"
      WHERE r.phone = ${phone}
        AND c.status IN ('PROCESSING', 'COMPLETED', 'PARTIAL')
        AND (${tenantId}::int IS NULL OR c."tenantId" IS NULL OR c."tenantId" = ${tenantId})
      ORDER BY (r."repliedAt" IS NOT NULL) ASC, c."createdAt" DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async recipientCounts(campaignId) {
    const rows = await this.prisma.$queryRaw`
      SELECT status, COUNT(*)::int AS count
      FROM "campaign_recipients"
      WHERE "campaignId" = ${Number(campaignId)}
      GROUP BY status
    `;
    const counts = { PENDING: 0, SENT: 0, FAILED: 0 };
    for (const row of rows) {
      if (row.status in counts) counts[row.status] = row.count;
    }
    return counts;
  }

  /**
   * Recomputes campaign counters from recipient state. Idempotent, so it
   * is safe to call after bulk sends and after each delivery/read
   * callback.
   */
  async syncCounters(campaignId) {
    return this.prisma.$executeRaw`
      UPDATE "campaigns" c
      SET "totalRecipients" = COALESCE(t.total, 0),
          "sentCount" = COALESCE(t.sent, 0),
          "deliveredCount" = COALESCE(t.delivered, 0),
          "readCount" = COALESCE(t.read, 0),
          "failedCount" = COALESCE(t.failed, 0)
      FROM (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent,
          COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered,
          COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)::int AS read,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM "campaign_recipients"
        WHERE "campaignId" = ${Number(campaignId)}
      ) t
      WHERE c.id = ${Number(campaignId)}
    `;
  }
}

module.exports = { CampaignRepository, CAMPAIGN_STATUS, RECIPIENT_STATUS };
