const prismaClient = require('../database/prisma');

/**
 * Persistence for the Conversation aggregate. Supports multi-tenant scoping.
 */
class ConversationRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.conversation.findUnique({
      where: { id: Number(id) },
      include: { contact: true },
    });
  }

  async findByContactAndChannel(contactId, channelNumber, tenantId = null) {
    const where = { contactId_channelNumber: { contactId: Number(contactId), channelNumber } };
    const conv = await this.prisma.conversation.findUnique({
      where,
      include: { contact: true },
    });
    if (conv && tenantId !== null && tenantId !== undefined && conv.tenantId !== Number(tenantId)) {
      return null;
    }
    return conv;
  }

  async findByExternalChatId(bitrix24ExternalChatId, tenantId = null) {
    if (!bitrix24ExternalChatId) return null;
    const where = { bitrix24ExternalChatId };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.conversation.findFirst({
      where,
      include: { contact: true },
    });
  }

  async create(data) {
    return this.prisma.conversation.create({
      data: {
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        contactId: Number(data.contactId),
        channelNumber: data.channelNumber,
        provider: data.provider ?? 'WHATSBOX',
        phoneNumberId: data.phoneNumberId ?? null,
        status: data.status ?? 'OPEN',
        whatsappThreadId: data.whatsappThreadId ?? null,
        bitrix24ThreadId: data.bitrix24ThreadId ?? null,
        bitrix24ExternalChatId: data.bitrix24ExternalChatId ?? null,
        leadId: data.leadId ? Number(data.leadId) : null,
        assignedAgentId: data.assignedAgentId ? Number(data.assignedAgentId) : null,
        lastMessageAt: data.lastMessageAt ?? null,
        lastMessagePreview: data.lastMessagePreview ?? null,
        lastMessageDirection: data.lastMessageDirection ?? null,
        lastMessageType: data.lastMessageType ?? null,
        unreadCount: data.unreadCount ? Number(data.unreadCount) : 0,
      },
    });
  }

  async update(id, data) {
    return this.prisma.conversation.update({
      where: { id: Number(id) },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.leadId !== undefined && { leadId: data.leadId ? Number(data.leadId) : null }),
        ...(data.provider !== undefined && { provider: data.provider }),
        ...(data.phoneNumberId !== undefined && { phoneNumberId: data.phoneNumberId }),
        ...(data.whatsappThreadId !== undefined && { whatsappThreadId: data.whatsappThreadId }),
        ...(data.bitrix24ThreadId !== undefined && { bitrix24ThreadId: data.bitrix24ThreadId }),
        ...(data.bitrix24ExternalChatId !== undefined && { bitrix24ExternalChatId: data.bitrix24ExternalChatId }),
        ...(data.assignedAgentId !== undefined && { assignedAgentId: data.assignedAgentId ? Number(data.assignedAgentId) : null }),
        ...(data.closedAt !== undefined && { closedAt: data.closedAt }),
        ...(data.lastMessageAt !== undefined && { lastMessageAt: data.lastMessageAt }),
        ...(data.lastMessagePreview !== undefined && { lastMessagePreview: data.lastMessagePreview }),
        ...(data.lastMessageDirection !== undefined && { lastMessageDirection: data.lastMessageDirection }),
        ...(data.lastMessageType !== undefined && { lastMessageType: data.lastMessageType }),
        ...(data.unreadCount !== undefined && { unreadCount: Number(data.unreadCount) }),
      },
    });
  }

  async touchLastMessage(id, { direction, type, preview, at = new Date(), incrementUnread = false }) {
    const data = {
      lastMessageAt: at,
      lastMessageDirection: direction,
      lastMessageType: type,
      lastMessagePreview: preview ? preview.slice(0, 500) : null,
    };
    if (incrementUnread) data.unreadCount = { increment: 1 };
    return this.prisma.conversation.update({ where: { id: Number(id) }, data });
  }

  async reopen(id) {
    return this.update(id, { status: 'OPEN', closedAt: null });
  }

  async close(id, closedAt = new Date()) {
    return this.update(id, { status: 'CLOSED', closedAt });
  }

  async list({ search = null, status = null, assignedAgentId = null, tenantId = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    if (status) where.status = status;
    if (assignedAgentId) where.assignedAgentId = Number(assignedAgentId);
    if (search) {
      where.OR = [
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { contact: { firstName: { contains: search, mode: 'insensitive' } } },
        { contact: { lastName: { contains: search, mode: 'insensitive' } } },
        { contact: { whatsappPhone: { contains: search } } },
      ];
    }

    const takeCount = Number(limit) || 50;
    const skipCount = Number(offset) || 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: { contact: true, assignedAgent: { select: { id: true, name: true } } },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: takeCount,
        skip: skipCount,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total };
  }

  async countByStatus(tenantId = null) {
    const where = {};
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    const groups = await this.prisma.conversation.groupBy({
      by: ['status'],
      where,
      _count: true,
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count]));
  }

  async countOpen(tenantId = null) {
    const where = { status: 'OPEN' };
    if (tenantId !== null && tenantId !== undefined) {
      where.tenantId = Number(tenantId);
    }
    return this.prisma.conversation.count({ where });
  }
}

module.exports = { ConversationRepository };
