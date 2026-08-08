const prismaClient = require('../database/prisma');

/**
 * Key/value configuration stored in the database (enables a settings
 * screen without redeploying). Values are JSON; `isSecret` rows are
 * masked in API responses.
 */
class SettingRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async get(key) {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row ? row.value : null;
  }

  async getRaw(key) {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  async set(key, value, { type = 'string', description = null, isSecret = false } = {}) {
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value, type, description, isSecret },
      update: { value, type, description, isSecret },
    });
  }

  async remove(key) {
    try {
      await this.prisma.setting.delete({ where: { key } });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
    }
  }

  async list({ includeSecrets = false } = {}) {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => {
      const publicRow = { ...r };
      if (r.isSecret && !includeSecrets) publicRow.value = '********';
      return publicRow;
    });
  }

  async count() {
    return this.prisma.setting.count();
  }
}

module.exports = { SettingRepository };
