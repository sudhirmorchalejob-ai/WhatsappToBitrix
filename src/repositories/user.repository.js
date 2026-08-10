const prismaClient = require('../database/prisma');

class UserRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    if (!id) return null;
    return this.prisma.user.findUnique({
      where: { id: Number(id) },
      include: { tenant: true },
    });
  }

  async findByEmail(email) {
    if (!email) return null;
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: true },
    });
  }

  async findByResetToken(resetPasswordToken) {
    if (!resetPasswordToken) return null;
    return this.prisma.user.findFirst({
      where: { resetPasswordToken },
      include: { tenant: true },
    });
  }

  async create(data) {
    return this.prisma.user.create({
      data: {
        ...data,
        email: data.email.toLowerCase().trim(),
      },
      include: { tenant: true },
    });
  }

  async update(id, data) {
    return this.prisma.user.update({
      where: { id: Number(id) },
      data,
      include: { tenant: true },
    });
  }

  async listByTenant(tenantId, { skip = 0, limit = 50 } = {}) {
    const where = tenantId ? { tenantId: Number(tenantId) } : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }
}

module.exports = { UserRepository };
