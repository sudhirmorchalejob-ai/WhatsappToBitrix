const prismaClient = require('../database/prisma');
const { normalizePhone } = require('../helpers/phone');

class TenantRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    if (!id) return null;
    return this.prisma.tenant.findUnique({ where: { id: Number(id) } });
  }

  async findByWhatsboxChannelId(channelId) {
    const normalized = normalizePhone(channelId);
    if (!normalized) return null;

    const candidates = await this.prisma.tenant.findMany({
      where: { whatsboxChannelId: { not: null } },
      select: { id: true, whatsboxChannelId: true },
    });

    return (
      candidates.find((tenant) => normalizePhone(tenant.whatsboxChannelId) === normalized) || null
    );
  }

  async findBySlug(slug) {
    if (!slug) return null;
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  async create(data) {
    return this.prisma.tenant.create({ data });
  }

  async update(id, data) {
    return this.prisma.tenant.update({
      where: { id: Number(id) },
      data,
    });
  }

  async list({ skip = 0, limit = 50, status } = {}) {
    const where = {};
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { items, total };
  }

  async findFirstActive() {
    return this.prisma.tenant.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
  }
}

module.exports = { TenantRepository };
