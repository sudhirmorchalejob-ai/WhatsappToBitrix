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
 * Recipients live in the `campaign_recipients` table (created by a
 * migration) and are accessed through raw SQL because the Prisma client
 * is generated from the schema on the deploy machine; keeping this in
 * raw queries avoids requiring a client regeneration to ship the feature.
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

  // ---------------- Recipients (raw SQL) ----------------

  async addRecipients(campaignId, phones) {
    const unique = [...new Set(phones.map((p) => String(p).trim()).filter(Boolean))];
    if (!unique.length) return 0;

    const rows = unique.map((phone) => Prisma.sql`(${Number(campaignId)}, ${phone}, NOW())`);
    const res = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "campaign_recipients" ("campaignId", "phone", "createdAt")
      VALUES ${Prisma.join(rows)}
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
        "sentAt" AS "sentAt",
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

  async updateRecipientStatus(id, { status, error = null, sentAt = null }) {
    return this.prisma.$executeRaw`
      UPDATE "campaign_recipients"
      SET status = ${status}, error = ${error}, "sentAt" = ${sentAt}
      WHERE id = ${Number(id)}
    `;
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
}

module.exports = { CampaignRepository, CAMPAIGN_STATUS, RECIPIENT_STATUS };
