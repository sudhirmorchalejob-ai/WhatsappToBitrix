const prismaClient = require('../database/prisma');

/**
 * Key/value configuration stored in the database. Supports multi-tenant scoping.
 */
class SettingRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async get(key, tenantId = null) {
    const row = await this.getRaw(key, tenantId);
    return row ? row.value : null;
  }

  async getRaw(key, tenantId = null) {
    if (tenantId !== null && tenantId !== undefined) {
      return this.prisma.setting.findFirst({ where: { key, tenantId: Number(tenantId) } });
    }
    return this.prisma.setting.findFirst({ where: { key } });
  }

  async set(key, value, { type = 'string', description = null, isSecret = false, tenantId = null } = {}) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const existing = await this.getRaw(key, tId);
    if (existing) {
      return this.prisma.setting.update({
        where: { id: existing.id },
        data: { value, type, description, isSecret },
      });
    }
    return this.prisma.setting.create({
      data: { tenantId: tId, key, value, type, description, isSecret },
    });
  }

  async remove(key, tenantId = null) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const existing = await this.getRaw(key, tId);
    if (existing) {
      await this.prisma.setting.delete({ where: { id: existing.id } });
    }
  }

  async list({ includeSecrets = false, tenantId = null } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    const rows = await this.prisma.setting.findMany({ where, orderBy: { key: 'asc' } });
    return rows.map((r) => {
      const publicRow = { ...r };
      if (r.isSecret && !includeSecrets) publicRow.value = '********';
      return publicRow;
    });
  }

  async count(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.setting.count({ where });
  }
}

module.exports = { SettingRepository };
