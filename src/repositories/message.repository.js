const prismaClient = require('../database/prisma');

/**
 * Persistence for the Message aggregate — the audit log of every
 * WhatsApp exchange. Incoming webhooks are idempotent by
 * whatsboxMessageId (unique column).
 */
class MessageRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.message.findUnique({
      where: { id },
      include: { conversation: { include: { contact: true } }, statuses: { orderBy: { timestamp: 'asc' } } },
    });
  }

  /** Used for dedup: if an incoming webhook repeats a provider ID, skip. */
  async findByWhatsboxMessageId(whatsboxMessageId) {
    if (!whatsboxMessageId) return null;
    return this.prisma.message.findUnique({ where: { whatsboxMessageId } });
  }

  async findByWamid(wamid) {
    if (!wamid) return null;
    return this.prisma.message.findUnique({ where: { wamid } });
  }

  /**
   * Operator replies are deduplicated by the Bitrix24 message id stored
   * in the JSON payload (b24:{member}:{messageId}); the column keeps its
   * WhatsApp-provider meaning, so the two id spaces never collide.
   */
  async findByOperatorReplyId(operatorReplyId) {
    if (!operatorReplyId) return null;
    return this.prisma.message.findFirst({
      where: { payload: { path: ['operatorReplyId'], equals: operatorReplyId } },
    });
  }

  async create(data) {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        contactId: data.contactId,
        dealId: data.dealId ?? null,
        whatsboxMessageId: data.whatsboxMessageId ?? null,
        wamid: data.wamid ?? null,
        direction: data.direction,
        type: data.type,
        body: data.body ?? null,
        caption: data.caption ?? null,
        mediaUrl: data.mediaUrl ?? null,
        mediaMimeType: data.mediaMimeType ?? null,
        mediaName: data.mediaName ?? null,
        mediaSize: data.mediaSize ?? null,
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
      where: { id },
      data: {
        ...(data.whatsboxMessageId !== undefined && { whatsboxMessageId: data.whatsboxMessageId }),
        ...(data.wamid !== undefined && { wamid: data.wamid }),
        ...(data.dealId !== undefined && { dealId: data.dealId }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.error !== undefined && { error: data.error }),
        ...(data.retryCount !== undefined && { retryCount: data.retryCount }),
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
      where: { id },
      data: { retryCount: { increment: 1 } },
    });
  }

  /**
   * List endpoint support. Every filter is optional. `mediaOnly`
   * narrows to media message types for the admin/media browser.
   */
  async list({
    conversationId = null,
    contactId = null,
    dealId = null,
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
    if (conversationId) where.conversationId = conversationId;
    if (contactId) where.contactId = contactId;
    if (dealId) where.dealId = dealId;
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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        include: {
          conversation: { select: { id: true, channelNumber: true } },
          contact: { select: { id: true, whatsappPhone: true, name: true, firstName: true, lastName: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.message.count({ where }),
    ]);

    return { items, total };
  }

  async countByStatus() {
    const groups = await this.prisma.message.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(groups.map((g) => [g.status, g._count]));
  }

  async countByDirection() {
    const groups = await this.prisma.message.groupBy({ by: ['direction'], _count: true });
    return Object.fromEntries(groups.map((g) => [g.direction, g._count]));
  }

  /** Daily message volume grouped by date, for the dashboard. */
  async dailyVolume({ from, to } = {}) {
    const where = {};
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

  /**
   * Outgoing messages whose delivery is still pending and that have not
   * exhausted their retry budget. The retry job pulls these.
   */
  async findPendingOutgoing({ maxRetries, limit = 50, olderThanMinutes = 5 }) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return this.prisma.message.findMany({
      where: {
        direction: 'OUTGOING',
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: maxRetries },
        OR: [
          { sentAt: null },
          { sentAt: { lte: cutoff } },
          { createdAt: { lte: cutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { conversation: { include: { contact: true } } },
    });
  }

  /** Size of the retry backlog (for the diagnostics overview). */
  async countPendingOutgoing({ maxRetries }) {
    return this.prisma.message.count({
      where: {
        direction: 'OUTGOING',
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: maxRetries },
      },
    });
  }
}

module.exports = { MessageRepository };
