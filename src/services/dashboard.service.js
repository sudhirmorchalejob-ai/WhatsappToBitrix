const prismaClient = require('../database/prisma');
const { Prisma } = require('@prisma/client');
const { TenantService } = require('./tenant.service');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { WebhookLogRepository } = require('../repositories/webhookLog.repository');

class DashboardService {
  constructor({
    prisma = prismaClient,
    tenantService = new TenantService(),
    activityLogRepo = new ActivityLogRepository(),
    webhookLogRepo = new WebhookLogRepository(),
  } = {}) {
    this.prisma = prisma;
    this.tenantService = tenantService;
    this.activityLogRepo = activityLogRepo;
    this.webhookLogRepo = webhookLogRepo;
  }

  async getStats(tenantId = null) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const whereTenant = tId !== null ? { tenantId: tId } : {};
    // All contacts for the tenant: WhatsApp-originated rows PLUS rows pulled in
    // by the Bitrix24 auto-sync (createdVia = BITRIX24_SYNC).
    const whereAll = { ...whereTenant };
    // A contact counts as a "lead" once it is linked to a Bitrix24 entity
    // (a CRM contact id, or a CRM lead id stored in meta).
    const linkedLead = {
      ...whereTenant,
      OR: [
        { bitrix24ContactId: { not: null } },
        { meta: { path: ['bitrix24LeadId'], not: Prisma.DbNull } },
      ],
    };
    // WhatsApp-only subset kept separate so the dashboard can still show how
    // many leads arrived through incoming WhatsApp messages.
    const whereWhatsapp = { ...whereTenant, createdVia: 'WHATSAPP' };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalCustomers,
      totalConversations,
      activeConversations,
      totalMessages,
      outgoingMessages,
      incomingMessages,
      failedMessages,
      automatedMessages,
      todaysContacts,
      recentLeads,
      connectionStatus,
    ] = await Promise.all([
      this.prisma.contact.count({ where: whereAll }),
      this.prisma.conversation.count({ where: whereTenant }),
      this.prisma.conversation.count({ where: { ...whereTenant, status: 'OPEN' } }),
      this.prisma.message.count({ where: whereTenant }),
      this.prisma.message.count({ where: { ...whereTenant, direction: 'OUTGOING' } }),
      this.prisma.message.count({ where: { ...whereTenant, direction: 'INCOMING' } }),
      this.prisma.message.count({ where: { ...whereTenant, status: 'FAILED' } }),
      this.prisma.autoReplyLog.count({ where: whereTenant }),
      this.prisma.contact.count({
        where: {
          ...whereAll,
          createdAt: { gte: todayStart },
        },
      }),
      this.prisma.contact.findMany({
        where: linkedLead,
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
      this.tenantService.testConnection(tId).catch((err) => ({ ok: false, error: err.message })),
    ]);

    // All Bitrix-linked contacts = total leads on the dashboard.
    const totalLeads = await this.prisma.contact.count({ where: linkedLead });
    const todaysLeads = await this.prisma.contact.count({
      where: { ...linkedLead, createdAt: { gte: todayStart } },
    });
    // WhatsApp-originated leads (synced to Bitrix24).
    const whatsappLeads = await this.prisma.contact.count({
      where: {
        ...whereWhatsapp,
        bitrix24ContactId: { not: null },
      },
    });
    const todaysWhatsappLeads = await this.prisma.contact.count({
      where: {
        ...whereWhatsapp,
        bitrix24ContactId: { not: null },
        createdAt: { gte: todayStart },
      },
    });

    return {
      kpis: {
        totalCustomers,
        totalLeads,
        totalMessages,
        activeConversations,
        campaignMessages: outgoingMessages,
        automatedMessages,
        todaysLeads,
        failedMessages,
        incomingMessages,
        leadsCreatedViaWhatsApp: whatsappLeads,
        todaysWhatsAppLeads: todaysWhatsappLeads,
      },
      connectionStatus,
      recentLeads: recentLeads.map((c) => ({
        id: c.id,
        name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || `+${c.whatsappPhone}`,
        phone: c.whatsappPhone,
        email: c.email,
        company: c.company,
        bitrixContactId: c.bitrix24ContactId,
        bitrixLeadId: c.meta && c.meta.bitrix24LeadId,
        syncStatus: c.syncStatus,
        createdAt: c.createdAt,
        lastActivityAt: c.lastActivityAt,
      })),
    };
  }

  async getLeadTrends(tenantId = null, days = 14) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;
    const whereTenant = tId !== null ? { tenantId: tId } : {};

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [contacts, messages] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          ...whereTenant,
          createdAt: { gte: startDate },
        },
        select: { createdAt: true, bitrix24ContactId: true, meta: true },
      }),
      this.prisma.message.findMany({
        where: {
          ...whereTenant,
          createdAt: { gte: startDate },
        },
        select: { createdAt: true, direction: true },
      }),
    ]);

    const trendMap = {};

    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      trendMap[dateStr] = {
        date: dateStr,
        customers: 0,
        leads: 0,
        incomingMessages: 0,
        outgoingMessages: 0,
      };
    }

    for (const c of contacts) {
      const day = c.createdAt.toISOString().slice(0, 10);
      if (trendMap[day]) {
        trendMap[day].customers += 1;
        const linked = c.bitrix24ContactId || (c.meta && c.meta.bitrix24LeadId);
        if (linked) trendMap[day].leads += 1;
      }
    }

    for (const m of messages) {
      const day = m.createdAt.toISOString().slice(0, 10);
      if (trendMap[day]) {
        if (m.direction === 'INCOMING') trendMap[day].incomingMessages += 1;
        if (m.direction === 'OUTGOING') trendMap[day].outgoingMessages += 1;
      }
    }

    return Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Dashboard history feeds:
   *  - connectionHistory: when the tenant saved / updated its WhatsApp +
   *    Bitrix24 integration (ActivityLog category INTEGRATION).
   *  - webhookHistory: recent provider webhook deliveries for the tenant
   *    (WebhookLog rows, attributed to the tenant on receipt).
   */
  async getHistory(tenantId = null, { limit = 20 } = {}) {
    const tId = tenantId !== null && tenantId !== undefined ? Number(tenantId) : null;

    const [connectionHistory, webhookHistory, webhookTotal] = await Promise.all([
      this.activityLogRepo.list({
        tenantId: tId,
        category: 'INTEGRATION',
        limit,
      }),
      this.webhookLogRepo.listRecent({ tenantId: tId, limit }),
      this.webhookLogRepo.count({ tenantId: tId }),
    ]);

    return {
      connectionHistory: {
        items: connectionHistory.items,
        total: connectionHistory.total,
      },
      webhookHistory: {
        items: webhookHistory,
        total: webhookTotal,
      },
    };
  }
}

module.exports = { DashboardService };
