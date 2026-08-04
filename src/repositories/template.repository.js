const prismaClient = require('../database/prisma');

/**
 * Persistence for reply templates (canned messages). Supports multi-tenant scoping.
 */
class TemplateRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async create(data) {
    return this.prisma.template.create({
      data: {
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        name: data.name,
        body: data.body,
        category: data.category ?? null,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async findById(id) {
    return this.prisma.template.findUnique({ where: { id: Number(id) } });
  }

  async findDefault(tenantId = null) {
    const where = { isDefault: true, isActive: true };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.template.findFirst({
      where,
      orderBy: { id: 'asc' },
    });
  }

  async list({ tenantId = null, isActive = null, category = null, search = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (isActive !== null) where.isActive = isActive;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.template.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.template.count({ where }),
    ]);

    return { items, total };
  }

  async update(id, data) {
    return this.prisma.template.update({
      where: { id: Number(id) },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      },
    });
  }

  async delete(id) {
    try {
      await this.prisma.template.delete({ where: { id: Number(id) } });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
    }
  }

  async clearDefault(tenantId = null) {
    const where = { isDefault: true };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    await this.prisma.template.updateMany({ where, data: { isDefault: false } });
  }

  async incrementUsage(id) {
    await this.prisma.template.updateMany({
      where: { id: Number(id) },
      data: { usageCount: { increment: 1 } },
    });
  }
}

module.exports = { TemplateRepository };
