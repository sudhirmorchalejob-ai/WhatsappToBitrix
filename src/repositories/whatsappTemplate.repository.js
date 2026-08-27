const prismaClient = require('../database/prisma');

class WhatsAppTemplateRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id, tenantId = null) {
    if (!id) return null;
    return this.prisma.whatsAppTemplate.findFirst({
      where: {
        id: Number(id),
        ...(tenantId ? { tenantId: Number(tenantId) } : {}),
      },
    });
  }

  async findByNameAndLanguage(templateName, language, tenantId = null) {
    if (!templateName || !language) return null;
    return this.prisma.whatsAppTemplate.findFirst({
      where: {
        templateName,
        language,
        ...(tenantId ? { tenantId: Number(tenantId) } : {}),
      },
    });
  }

  async upsert(tenantId, data) {
    const existing = await this.findByNameAndLanguage(data.templateName, data.language, tenantId);
    if (existing) {
      return this.prisma.whatsAppTemplate.update({
        where: { id: existing.id },
        data: {
          category: data.category,
          status: data.status || 'ACTIVE',
          bodyText: data.bodyText || null,
          headerType: data.headerType || null,
          headerText: data.headerText || null,
          buttons: data.buttons || null,
          components: data.components || null,
          raw: data.raw || null,
          fetchedAt: new Date(),
        },
      });
    }
    return this.prisma.whatsAppTemplate.create({
      data: {
        tenantId: tenantId ? Number(tenantId) : null,
        templateName: data.templateName,
        language: data.language,
        category: data.category,
        status: data.status || 'ACTIVE',
        bodyText: data.bodyText || null,
        headerType: data.headerType || null,
        headerText: data.headerText || null,
        buttons: data.buttons || null,
        components: data.components || null,
        raw: data.raw || null,
      },
    });
  }

  async upsertMany(tenantId, templates) {
    const results = [];
    for (const tpl of templates) {
      const row = await this.upsert(tenantId, tpl);
      results.push(row);
    }
    return results;
  }

  async list({ tenantId = null, category = null, status = null, search = null, limit = 100, offset = 0 } = {}) {
    const where = {};
    if (tenantId) where.tenantId = Number(tenantId);
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) where.templateName = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.whatsAppTemplate.findMany({
        where,
        orderBy: [{ category: 'asc' }, { templateName: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.whatsAppTemplate.count({ where }),
    ]);
    return { items, total };
  }

  async delete(id) {
    return this.prisma.whatsAppTemplate.delete({ where: { id: Number(id) } });
  }

  async deleteByTenant(tenantId) {
    return this.prisma.whatsAppTemplate.deleteMany({
      where: { tenantId: Number(tenantId) },
    });
  }
}

module.exports = { WhatsAppTemplateRepository };
