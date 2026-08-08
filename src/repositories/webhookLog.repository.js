const prismaClient = require('../database/prisma');

/**
 * Audit trail for every received webhook. Written BEFORE processing
 * (status RECEIVED), updated after (PROCESSED / FAILED).
 */
class WebhookLogRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async create({ source, eventType, payload, status = 'RECEIVED', httpCode = null, errorMessage = null, ip = null, signature = null }) {
    return this.prisma.webhookLog.create({
      data: { source, eventType, payload, status, httpCode, errorMessage, ip, signature },
    });
  }

  async markProcessed(id, { status, errorMessage = null, httpCode = null, processedAt = new Date() }) {
    return this.prisma.webhookLog.update({
      where: { id },
      data: { status, errorMessage, httpCode, processedAt },
    });
  }

  async listRecent({ source = null, status = null, limit = 50, offset = 0 } = {}) {
    return this.prisma.webhookLog.findMany({
      where: {
        ...(source && { source }),
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async count({ source = null, status = null } = {}) {
    return this.prisma.webhookLog.count({
      where: {
        ...(source && { source }),
        ...(status && { status }),
      },
    });
  }

  async countBySource({ source, from = null, to = null } = {}) {
    const where = { source };
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      };
    }

    const groups = await this.prisma.webhookLog.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    const counts = { RECEIVED: 0, PROCESSED: 0, FAILED: 0 };
    for (const g of groups) counts[g.status] = g._count;
    return counts;
  }
}

module.exports = { WebhookLogRepository };
