const prismaClient = require('../database/prisma');
const { SYNC_STATUS } = require('../constants');

/**
 * Persistence for the Contact aggregate. Supports multi-tenant scoping.
 */
class ContactRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findByWhatsappPhone(whatsappPhone, tenantId = null) {
    const where = { whatsappPhone };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.contact.findFirst({ where });
  }

  async findByBitrix24Id(bitrix24ContactId, tenantId = null) {
    const where = { bitrix24ContactId: Number(bitrix24ContactId) };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.contact.findFirst({ where });
  }

  async findByBitrix24LeadId(bitrix24LeadId, tenantId = null) {
    const where = {
      meta: { path: ['bitrix24LeadId'], equals: Number(bitrix24LeadId) },
    };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.contact.findFirst({ where });
  }

  async findById(id) {
    return this.prisma.contact.findUnique({ where: { id: Number(id) } });
  }

  async create(data) {
    return this.prisma.contact.create({
      data: {
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        whatsappPhone: data.whatsappPhone,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        name: data.name ?? null,
        email: data.email ?? null,
        company: data.company ?? null,
        avatarUrl: data.avatarUrl ?? null,
        bitrix24ContactId: data.bitrix24ContactId ? Number(data.bitrix24ContactId) : null,
        syncStatus: data.syncStatus ?? SYNC_STATUS.PENDING,
        createdVia: data.createdVia ?? 'WHATSAPP',
        meta: data.meta ?? undefined,
      },
    });
  }

  async upsertByWhatsappPhone(whatsappPhone, tenantId, data) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    return this.prisma.contact.upsert({
      where: { tenantId_whatsappPhone: { tenantId: tId, whatsappPhone } },
      create: {
        tenantId: tId,
        whatsappPhone,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        name: data.name ?? null,
        email: data.email ?? null,
        company: data.company ?? null,
        avatarUrl: data.avatarUrl ?? null,
        bitrix24ContactId: data.bitrix24ContactId ? Number(data.bitrix24ContactId) : null,
        syncStatus: data.syncStatus ?? SYNC_STATUS.PENDING,
        createdVia: data.createdVia ?? 'WHATSAPP',
        meta: data.meta ?? undefined,
      },
      update: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.company !== undefined && { company: data.company }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(data.isBlocked !== undefined && { isBlocked: data.isBlocked }),
        ...(data.bitrix24ContactId !== undefined && {
          bitrix24ContactId: data.bitrix24ContactId ? Number(data.bitrix24ContactId) : null,
        }),
        ...(data.syncStatus !== undefined && { syncStatus: data.syncStatus }),
        ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
        ...(data.meta !== undefined && { meta: data.meta }),
      },
    });
  }

  async update(id, data) {
    return this.prisma.contact.update({
      where: { id: Number(id) },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.company !== undefined && { company: data.company }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(data.isBlocked !== undefined && { isBlocked: data.isBlocked }),
        ...(data.bitrix24ContactId !== undefined && { bitrix24ContactId: data.bitrix24ContactId ? Number(data.bitrix24ContactId) : null }),
        ...(data.syncStatus !== undefined && { syncStatus: data.syncStatus }),
        ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
        ...(data.meta !== undefined && { meta: data.meta }),
      },
    });
  }

  async touchLastActivity(id, at = new Date()) {
    return this.prisma.contact.update({
      where: { id: Number(id) },
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

  async list({ search = null, syncStatus = null, createdVia = null, tenantId = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { whatsappPhone: { contains: search } },
      ];
    }
    if (syncStatus) where.syncStatus = syncStatus;
    if (createdVia) where.createdVia = createdVia;

    const takeCount = Number(limit) || 50;
    const skipCount = Number(offset) || 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: takeCount,
        skip: skipCount,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { items, total };
  }

  async countBySyncStatus(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    const groups = await this.prisma.contact.groupBy({
      by: ['syncStatus'],
      where,
      _count: true,
    });
    return Object.fromEntries(groups.map((g) => [g.syncStatus, g._count]));
  }

  /**
   * Contacts for the tenant that have no conversation yet, so the WhatsApp
   * Chats view can show every synced contact as an (empty) chat.
   */
  async listWithoutConversations({ tenantId = null, excludeIds = [], limit = 50 } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (excludeIds && excludeIds.length) {
      where.id = { notIn: excludeIds.map(Number) };
    }
    return this.prisma.contact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Number(limit) || 50,
    });
  }

  async findUnsynced({ statuses = ['PENDING', 'FAILED'], tenantId = null, limit = 50 } = {}) {
    const where = { syncStatus: { in: statuses } };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.contact.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: Number(limit) || 50,
    });
  }
}

module.exports = { ContactRepository };
