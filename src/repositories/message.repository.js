const prismaClient = require('../database/prisma');

/**
 * Persistence for the Message aggregate — supports multi-tenant scoping.
 */
class MessageRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.message.findUnique({
      where: { id: Number(id) },
      include: { conversation: { include: { contact: true } }, statuses: { orderBy: { timestamp: 'asc' } } },
    });
  }

  async findByWhatsboxMessageId(whatsboxMessageId, tenantId = null) {
    if (!whatsboxMessageId) return null;
    const where = { whatsboxMessageId };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.message.findFirst({ where });
  }

  async findByWamid(wamid, tenantId = null) {
    if (!wamid) return null;
    const where = { wamid };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.message.findFirst({ where });
  }

  async findByOperatorReplyId(operatorReplyId, tenantId = null) {
    if (!operatorReplyId) return null;
    const where = { payload: { path: ['operatorReplyId'], equals: operatorReplyId } };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.message.findFirst({ where });
  }

  async create(data) {
    return this.prisma.message.create({
      data: {
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        conversationId: Number(data.conversationId),
        contactId: Number(data.contactId),
        leadId: data.leadId ? Number(data.leadId) : null,
        whatsboxMessageId: data.whatsboxMessageId ?? null,
        wamid: data.wamid ?? null,
        direction: data.direction,
        type: data.type,
        body: data.body ?? null,
        caption: data.caption ?? null,
        mediaUrl: data.mediaUrl ?? null,
        mediaMimeType: data.mediaMimeType ?? null,
        mediaName: data.mediaName ?? null,
        mediaSize: data.mediaSize ? Number(data.mediaSize) : null,
        locationData: data.locationData ?? undefined,
        contactCard: data.contactCard ?? undefined,
        payload: data.payload ?? undefined,
        timestamp: data.timestamp ?? new Date(),
        status: data.status ?? 'PENDING',
      },
    });
  }

  async update(id, data) {
    return this.prisma.message.update({
      where: { id: Number(id) },
      data: {
        ...(data.whatsboxMessageId !== undefined && { whatsboxMessageId: data.whatsboxMessageId }),
        ...(data.wamid !== undefined && { wamid: data.wamid }),
        ...(data.leadId !== undefined && { leadId: data.leadId ? Number(data.leadId) : null }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.error !== undefined && { error: data.error }),
        ...(data.retryCount !== undefined && { retryCount: Number(data.retryCount) }),
        ...(data.sentAt !== undefined && { sentAt: data.sentAt }),
        ...(data.timestamp !== undefined && { timestamp: data.timestamp }),
      },
    });
  }

  async updateStatus(id, status, { error = null, sentAt = null } = {}) {
    return this.update(id, { status, error, sentAt });
  }

  async incrementRetryCount(id) {
    return this.prisma.message.update({
      where: { id: Number(id) },
      data: { retryCount: { increment: 1 } },
    });
  }

  async list({
    tenantId = null,
    conversationId = null,
    contactId = null,
    leadId = null,
    direction = null,
    status = null,
    type = null,
    mediaOnly = false,
    from = null,
    to = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (conversationId) where.conversationId = Number(conversationId);
    if (contactId) where.contactId = Number(contactId);
    if (leadId) where.leadId = Number(leadId);
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (type) where.type = type;
    if (mediaOnly) where.type = { in: ['IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'PDF'] };
    if (from || to) {
      where.timestamp = {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      };
    }

    const takeCount = Number(limit) || 50;
    const skipCount = Number(offset) || 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        include: {
          conversation: { select: { id: true, channelNumber: true } },
          contact: { select: { id: true, whatsappPhone: true, name: true, firstName: true, lastName: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: takeCount,
        skip: skipCount,
      }),
      this.prisma.message.count({ where }),
    ]);

    return { items, total };
  }

  async countByStatus(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    const groups = await this.prisma.message.groupBy({ by: ['status'], where, _count: true });
    return Object.fromEntries(groups.map((g) => [g.status, g._count]));
  }

  async countByDirection(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    const groups = await this.prisma.message.groupBy({ by: ['direction'], where, _count: true });
    return Object.fromEntries(groups.map((g) => [g.direction, g._count]));
  }

  async dailyVolume({ tenantId = null, from, to } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (from || to) {
      where.timestamp = {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      };
    }
    const rows = await this.prisma.message.findMany({
      where,
      select: { timestamp: true, direction: true },
    });
    const buckets = {};
    for (const r of rows) {
      const day = r.timestamp.toISOString().slice(0, 10);
      buckets[day] = buckets[day] || { date: day, INCOMING: 0, OUTGOING: 0 };
      buckets[day][r.direction] += 1;
    }
    return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  }

  async findPendingOutgoing({ tenantId = null, maxRetries, limit = 50, olderThanMinutes = 5 }) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const where = {
      direction: 'OUTGOING',
      status: { in: ['PENDING', 'FAILED'] },
      retryCount: { lt: Number(maxRetries) },
      OR: [
        { sentAt: null },
        { sentAt: { lte: cutoff } },
        { createdAt: { lte: cutoff } },
      ],
    };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: Number(limit) || 50,
      include: { conversation: { include: { contact: true } } },
    });
  }

  async countPendingOutgoing({ tenantId = null, maxRetries }) {
    const where = {
      direction: 'OUTGOING',
      status: { in: ['PENDING', 'FAILED'] },
      retryCount: { lt: Number(maxRetries) },
    };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.message.count({ where });
  }
}

module.exports = { MessageRepository };
