const prismaClient = require('../database/prisma');

/**
 * Persistence for local Bitrix24 user mirrors. Supports multi-tenant scoping.
 */
class AgentRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.agent.findUnique({ where: { id: Number(id) } });
  }

  async findByBitrix24Id(bitrix24UserId, tenantId = null) {
    const where = { bitrix24UserId: Number(bitrix24UserId) };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.agent.findFirst({ where });
  }

  async upsertFromBitrix24(user, tenantId = null) {
    const bitrix24UserId = Number(user.ID || user.id || user.bitrix24UserId);
    const data = {
      name: user.NAME || user.name || String(bitrix24UserId),
      email: user.EMAIL || user.email || null,
      phone: user.PERSONAL_MOBILE || user.WORK_PHONE || user.phone || null,
      avatarUrl: user.PERSONAL_PHOTO || user.avatarUrl || null,
      isActive: user.ACTIVE !== false && user.isActive !== false,
    };
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const existing = await this.findByBitrix24Id(bitrix24UserId, tId);
    if (existing) {
      return this.prisma.agent.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.agent.create({
      data: {
        tenantId: tId,
        bitrix24UserId,
        ...data,
      },
    });
  }

  async list({ active = null, tenantId = null, limit = 100 } = {}) {
    const where = {};
    if (active !== null) where.isActive = active;
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.agent.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  async listActive(tenantId = null, limit = 1000) {
    const where = { isActive: true };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.agent.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async count(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.agent.count({ where });
  }
}

module.exports = { AgentRepository };
