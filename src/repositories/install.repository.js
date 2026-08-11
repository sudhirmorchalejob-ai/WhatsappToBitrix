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
    tenantId = null,
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
    let resolvedTenantId = tenantId ? Number(tenantId) : null;
    if (!resolvedTenantId && domain) {
      const cleanDomain = String(domain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
      let tenant = await this.prisma.tenant.findFirst({
        where: {
          OR: [
            { bitrix24WebhookUrl: { contains: cleanDomain } },
            { name: { contains: cleanDomain } },
          ],
        },
      });
      if (!tenant) {
        tenant = await this.prisma.tenant.findFirst({ orderBy: { id: 'asc' } });
      }
      if (!tenant) {
        tenant = await this.prisma.tenant.create({
          data: {
            name: `Bitrix24 (${cleanDomain})`,
            bitrix24WebhookUrl: `https://${cleanDomain}/rest/`,
            isConfigured: true,
          },
        });
      }
      if (tenant) resolvedTenantId = tenant.id;
    }

    // Self-hosted (Box) installs report the OAuth authorization server
    // (oauth.bitrix.info) as `domain`. That host cannot serve REST calls,
    // so derive the real portal host from the client endpoint when present.
    let cleanDomain = domain;
    if (/oauth\.bitrix\.info/i.test(String(domain || '')) && clientEndpoint) {
      const match = String(clientEndpoint).match(/https?:\/\/([^/]+)/);
      if (match) cleanDomain = match[1];
    }

    const payload = {
      tenantId: resolvedTenantId,
      memberId,
      domain: cleanDomain,
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
    };

    const existing = await this.prisma.install.findFirst({
      where: {
        OR: [
          { memberId },
          ...(resolvedTenantId ? [{ tenantId: resolvedTenantId, memberId }] : []),
        ],
      },
    });

    if (existing) {
      // Preserve the previously stored connector/line bindings when the
      // new install payload does not carry them (re-installs must never
      // wipe the active open-line linkage).
      return this.prisma.install.update({
        where: { id: existing.id },
        data: {
          ...payload,
          connectorId: connectorId != null ? connectorId : existing.connectorId,
          lineId: lineId != null ? lineId : existing.lineId,
        },
      });
    }

    return this.prisma.install.create({
      data: payload,
    });
  }

  async findByMemberId(memberId) {
    if (!memberId) return null;
    return this.prisma.install.findFirst({ where: { memberId } });
  }

  /** Most recent active install for a tenant (used to report SMS delivery). */
  async findByTenantId(tenantId) {
    if (tenantId === null || tenantId === undefined) return null;
    return this.prisma.install.findFirst({
      where: { tenantId: Number(tenantId), status: INSTALL_STATUS.INSTALLED },
      orderBy: { updatedAt: 'desc' },
    });
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
    const existing = await this.findByMemberId(memberId);
    if (!existing) return null;

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
    return this.prisma.install.update({ where: { id: existing.id }, data });
  }

  /**
   * Records which open line the connector is bound to on this portal.
   * Used by the placement handler and auto-activation flow.
   */
  async updateOpenline(memberId, { connectorId = null, lineId = null }) {
    const existing = await this.findByMemberId(memberId);
    if (!existing) return null;

    const data = { updatedAt: new Date() };
    if (connectorId != null) data.connectorId = connectorId;
    if (lineId != null) data.lineId = lineId;
    return this.prisma.install.update({ where: { id: existing.id }, data });
  }

  async touch(memberId, at = new Date()) {
    const existing = await this.findByMemberId(memberId);
    if (!existing) return null;

    return this.prisma.install.update({
      where: { id: existing.id },
      data: { lastSeenAt: at, updatedAt: at },
    });
  }

  async markUninstalled(memberId, at = new Date()) {
    const existing = await this.findByMemberId(memberId);
    if (!existing) return null;

    return this.prisma.install.update({
      where: { id: existing.id },
      data: { status: INSTALL_STATUS.UNINSTALLED, lastSeenAt: at, updatedAt: at },
    });
  }

  async markDisabled(memberId, at = new Date()) {
    const existing = await this.findByMemberId(memberId);
    if (!existing) return null;

    return this.prisma.install.update({
      where: { id: existing.id },
      data: { status: INSTALL_STATUS.DISABLED, lastSeenAt: at, updatedAt: at },
    });
  }

  async remove(memberId) {
    const existing = await this.findByMemberId(memberId);
    if (!existing) return;

    try {
      await this.prisma.install.delete({ where: { id: existing.id } });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
    }
  }

  async count({ status = null } = {}) {
    return this.prisma.install.count({ where: status ? { status } : undefined });
  }
}

module.exports = { InstallRepository, INSTALL_STATUS };
