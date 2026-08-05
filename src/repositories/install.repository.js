const prismaClient = require('../database/prisma');

const INSTALL_STATUS = {
  INSTALLED: 'INSTALLED',
  UNINSTALLED: 'UNINSTALLED',
  DISABLED: 'DISABLED',
};

/**
 * One row per Bitrix24 portal that installed the marketplace app. Tokens
 * are stored in plaintext so the middleware can drive the portal's REST
 * API in the background; the `applicationToken` column is used to verify
 * ON_APP_UNINSTALL events (the only credential still valid afterwards).
 */
class InstallRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async upsert({
    memberId,
    domain,
    clientEndpoint = null,
    accessToken,
    refreshToken,
    applicationToken = null,
    connectorId = null,
    lineId = null,
    userId = null,
    scope = null,
    status = INSTALL_STATUS.INSTALLED,
    expiresAt = null,
    lastSeenAt = new Date(),
  }) {
    return this.prisma.install.upsert({
      where: { memberId },
      create: {
        memberId,
        domain,
        clientEndpoint,
        accessToken,
        refreshToken,
        applicationToken,
        connectorId,
        lineId,
        userId,
        scope,
        status,
        expiresAt,
        lastSeenAt,
      },
      update: {
        domain,
        clientEndpoint,
        accessToken,
        refreshToken,
        applicationToken,
        connectorId,
        lineId,
        userId,
        scope,
        status,
        expiresAt,
        lastSeenAt,
      },
    });
  }

  async findByMemberId(memberId) {
    if (!memberId) return null;
    return this.prisma.install.findFirst({ where: { memberId } });
  }

  async findActiveMostRecent() {
    return this.prisma.install.findFirst({
      where: { status: INSTALL_STATUS.INSTALLED },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async list({ status = null, limit = 100 } = {}) {
    return this.prisma.install.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async updateTokens(memberId, { accessToken, refreshToken = null, expiresAt = null, domain = null, clientEndpoint = null, scope = null, status = null }) {
    const data = {
      accessToken,
      updatedAt: new Date(),
    };
    if (refreshToken != null) data.refreshToken = refreshToken;
    if (expiresAt != null) data.expiresAt = expiresAt;
    if (domain != null) data.domain = domain;
    if (clientEndpoint != null) data.clientEndpoint = clientEndpoint;
    if (scope != null) data.scope = scope;
    if (status != null) data.status = status;
    return this.prisma.install.update({ where: { memberId }, data });
  }

  /**
   * Records which open line the connector is bound to on this portal.
   * Used by the placement handler and auto-activation flow.
   */
  async updateOpenline(memberId, { connectorId = null, lineId = null }) {
    const data = { updatedAt: new Date() };
    if (connectorId != null) data.connectorId = connectorId;
    if (lineId != null) data.lineId = lineId;
    return this.prisma.install.update({ where: { memberId }, data });
  }

  async touch(memberId, at = new Date()) {
    return this.prisma.install.update({
      where: { memberId },
      data: { lastSeenAt: at, updatedAt: at },
    });
  }

  async markUninstalled(memberId, at = new Date()) {
    return this.prisma.install.update({
      where: { memberId },
      data: { status: INSTALL_STATUS.UNINSTALLED, lastSeenAt: at, updatedAt: at },
    });
  }

  async markDisabled(memberId, at = new Date()) {
    return this.prisma.install.update({
      where: { memberId },
      data: { status: INSTALL_STATUS.DISABLED, lastSeenAt: at, updatedAt: at },
    });
  }

  async remove(memberId) {
    try {
      await this.prisma.install.delete({ where: { memberId } });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
    }
  }

  async count({ status = null } = {}) {
    return this.prisma.install.count({ where: status ? { status } : undefined });
  }
}

module.exports = { InstallRepository, INSTALL_STATUS };
