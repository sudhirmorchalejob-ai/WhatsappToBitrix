const prismaClient = require('../database/prisma');

/**
 * Persistence for reply templates (canned messages). `isDefault` marks
 * the template used when no explicit AUTO_REPLY template is configured.
 */
class TemplateRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async create(data) {
    return this.prisma.template.create({
      data: {
        name: data.name,
        body: data.body,
        category: data.category ?? null,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async findById(id) {
    return this.prisma.template.findUnique({ where: { id } });
  }

  /** The active default template, used as the auto-reply fallback. */
  async findDefault() {
    return this.prisma.template.findFirst({
      where: { isDefault: true, isActive: true },
      orderBy: { id: 'asc' },
    });
  }

  async list({ isActive = null, category = null, search = null, limit = 50, offset = 0 } = {}) {
    const where = {};
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
      where: { id },
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
      await this.prisma.template.delete({ where: { id } });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
    }
  }

  /** Unsets the default flag on every template (keeps at most one default). */
  async clearDefault() {
    await this.prisma.template.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  async incrementUsage(id) {
    await this.prisma.template.updateMany({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }
}

module.exports = { TemplateRepository };
