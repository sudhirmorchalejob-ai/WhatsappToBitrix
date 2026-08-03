const prismaClient = require('../database/prisma');
const { SYNC_STATUS } = require('../constants');

/**
 * Persistence for the Contact aggregate. All reads/writes to the
 * `contacts` table go through here so higher layers never touch Prisma
 * directly and stay swappable/testable.
 */
class ContactRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  /**
   * Lookup by normalized WhatsApp phone (unique column).
   * Returns the DB row or null. Do not leak a "not found" as an error —
   * the caller decides what to do.
   */
  async findByWhatsappPhone(whatsappPhone) {
    return this.prisma.contact.findUnique({ where: { whatsappPhone } });
  }

  async findByBitrix24Id(bitrix24ContactId) {
    return this.prisma.contact.findUnique({ where: { bitrix24ContactId } });
  }

  async findById(id) {
    return this.prisma.contact.findUnique({ where: { id } });
  }

  async create(data) {
    return this.prisma.contact.create({
      data: {
        whatsappPhone: data.whatsappPhone,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        name: data.name ?? null,
        email: data.email ?? null,
        company: data.company ?? null,
        avatarUrl: data.avatarUrl ?? null,
        bitrix24ContactId: data.bitrix24ContactId ?? null,
        syncStatus: data.syncStatus ?? SYNC_STATUS.PENDING,
        meta: data.meta ?? undefined,
      },
    });
  }

  async update(id, data) {
    return this.prisma.contact.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.company !== undefined && { company: data.company }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(data.isBlocked !== undefined && { isBlocked: data.isBlocked }),
        ...(data.bitrix24ContactId !== undefined && { bitrix24ContactId: data.bitrix24ContactId }),
        ...(data.syncStatus !== undefined && { syncStatus: data.syncStatus }),
        ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
        ...(data.meta !== undefined && { meta: data.meta }),
      },
    });
  }

  /**
   * Called whenever a WhatsApp event arrives for this contact. Keeps the
   * "last seen" signal fresh without clobbering other fields.
   */
  async touchLastActivity(id, at = new Date()) {
    return this.prisma.contact.update({
      where: { id },
      data: { lastActivityAt: at },
    });
  }

  async markSynced(id, bitrix24ContactId) {
    return this.update(id, {
      bitrix24ContactId,
      syncStatus: SYNC_STATUS.SYNCED,
    });
  }

  async markSyncFailed(id, meta) {
    return this.update(id, { syncStatus: SYNC_STATUS.FAILED, meta });
  }

  /**
   * Search endpoint support. `search` matches name / phone with a
   * case-insensitive LIKE; results are newest-first and paginated.
   */
  async list({ search = null, syncStatus = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { whatsappPhone: { contains: search } },
      ];
    }
    if (syncStatus) where.syncStatus = syncStatus;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { items, total };
  }

  async countBySyncStatus() {
    const groups = await this.prisma.contact.groupBy({
      by: ['syncStatus'],
      _count: true,
    });
    return Object.fromEntries(groups.map((g) => [g.syncStatus, g._count]));
  }

  /**
   * Contacts still waiting for Bitrix24 sync (created locally while the
   * CRM was unreachable, or the initial create failed). Oldest-first so
   * a backlog is drained in order; the resync job consumes these.
   */
  async findUnsynced({ statuses = ['PENDING', 'FAILED'], limit = 50 } = {}) {
    return this.prisma.contact.findMany({
      where: { syncStatus: { in: statuses } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }
}

module.exports = { ContactRepository };
