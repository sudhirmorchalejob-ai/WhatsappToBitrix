const prismaClient = require('../database/prisma');

class ActivityLogRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async log({ tenantId = null, userId = null, action, category = 'SYSTEM', details = null, ipAddress = null }) {
    try {
      return await this.prisma.activityLog.create({
        data: {
          tenantId: tenantId ? Number(tenantId) : null,
          userId: userId ? Number(userId) : null,
          action,
          category,
          details,
          ipAddress,
        },
      });
    } catch (err) {
      // Non-fatal logging failure
      console.error('[ActivityLogRepository] Failed to record log:', err.message);
      return null;
    }
  }

  async list({ tenantId = null, category = null, action = null, limit = 50, skip = 0 } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (category) where.category = category;
    if (action) where.action = action;

    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { items, total };
  }
}

module.exports = { ActivityLogRepository };
