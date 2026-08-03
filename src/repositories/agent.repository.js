const prismaClient = require('../database/prisma');

/**
 * Persistence for local Bitrix24 user mirrors. Bitrix24 is the source of
 * truth; these rows are a cache used for assignment and notifications.
 */
class AgentRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.agent.findUnique({ where: { id } });
  }

  async findByBitrix24Id(bitrix24UserId) {
    return this.prisma.agent.findUnique({ where: { bitrix24UserId } });
  }

  async upsertFromBitrix24(user) {
    const bitrix24UserId = user.ID || user.id;
    const data = {
      name: user.NAME || user.name || String(bitrix24UserId),
      email: user.EMAIL || null,
      phone: user.PERSONAL_MOBILE || user.WORK_PHONE || null,
      avatarUrl: user.PERSONAL_PHOTO || null,
      isActive: user.ACTIVE !== false,
    };
    return this.prisma.agent.upsert({
      where: { bitrix24UserId },
      create: { bitrix24UserId, ...data },
      update: data,
    });
  }

  async list({ active = null, limit = 100 } = {}) {
    return this.prisma.agent.findMany({
      where: active === null ? undefined : { isActive: active },
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  /** Active agents, oldest-created first (stable order for routing). */
  async listActive(limit = 1000) {
    return this.prisma.agent.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async count() {
    return this.prisma.agent.count();
  }
}

module.exports = { AgentRepository };
