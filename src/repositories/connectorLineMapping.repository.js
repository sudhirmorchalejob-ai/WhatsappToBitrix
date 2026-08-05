const prismaClient = require('../database/prisma');

class ConnectorLineMappingRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findByMemberAndLine(memberId, lineId) {
    if (!memberId || !lineId) return null;
    return this.prisma.connectorLineMapping.findFirst({
      where: { memberId: String(memberId), lineId: Number(lineId) },
    });
  }

  async findByMember(memberId) {
    if (!memberId) return [];
    return this.prisma.connectorLineMapping.findMany({
      where: { memberId: String(memberId) },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertMapping({ memberId, lineId, domain, connectorId = 'whatsapp_b24_connector', lineName = null, tenantId = null, status = 'ACTIVE' }) {
    if (!memberId || !lineId) return null;

    const existing = await this.findByMemberAndLine(memberId, lineId);
    if (existing) {
      return this.prisma.connectorLineMapping.update({
        where: { id: existing.id },
        data: {
          connectorId,
          domain: domain || existing.domain,
          lineName: lineName || existing.lineName,
          status,
          ...(tenantId && { tenantId: Number(tenantId) }),
        },
      });
    }

    return this.prisma.connectorLineMapping.create({
      data: {
        memberId: String(memberId),
        domain: domain || 'unknown',
        connectorId,
        lineId: Number(lineId),
        lineName,
        status,
        ...(tenantId && { tenantId: Number(tenantId) }),
      },
    });
  }
}

module.exports = { ConnectorLineMappingRepository };
