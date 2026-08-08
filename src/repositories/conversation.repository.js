const prismaClient = require('../database/prisma');

/**
 * Persistence for the Conversation aggregate. Conversations are keyed by
 * (contactId, channelNumber) — one open chat per contact per WhatsApp
 * channel number.
 */
class ConversationRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: { contact: true },
    });
  }

  async findByContactAndChannel(contactId, channelNumber) {
    return this.prisma.conversation.findUnique({
      where: { contactId_channelNumber: { contactId, channelNumber } },
      include: { contact: true },
    });
  }

  /**
   * Finds the conversation referenced by the Open Channels external chat
   * id (the `chat.id` we pass to imconnector.send.messages and that
   * Bitrix24 echoes back in ONIMCONNECTORMESSAGEADD events).
   */
  async findByExternalChatId(bitrix24ExternalChatId) {
    if (!bitrix24ExternalChatId) return null;
    return this.prisma.conversation.findUnique({
      where: { bitrix24ExternalChatId },
      include: { contact: true },
    });
  }

  async create(data) {
    return this.prisma.conversation.create({
      data: {
        contactId: data.contactId,
        channelNumber: data.channelNumber,
        provider: data.provider ?? 'WHATSBOX',
        phoneNumberId: data.phoneNumberId ?? null,
        status: data.status ?? 'OPEN',
        whatsappThreadId: data.whatsappThreadId ?? null,
        bitrix24ThreadId: data.bitrix24ThreadId ?? null,
        bitrix24ExternalChatId: data.bitrix24ExternalChatId ?? null,
        dealId: data.dealId ?? null,
        assignedAgentId: data.assignedAgentId ?? null,
        lastMessageAt: data.lastMessageAt ?? null,
        lastMessagePreview: data.lastMessagePreview ?? null,
        lastMessageDirection: data.lastMessageDirection ?? null,
        lastMessageType: data.lastMessageType ?? null,
        unreadCount: data.unreadCount ?? 0,
      },
    });
  }

  async update(id, data) {
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.dealId !== undefined && { dealId: data.dealId }),
        ...(data.provider !== undefined && { provider: data.provider }),
        ...(data.phoneNumberId !== undefined && { phoneNumberId: data.phoneNumberId }),
        ...(data.whatsappThreadId !== undefined && { whatsappThreadId: data.whatsappThreadId }),
        ...(data.bitrix24ThreadId !== undefined && { bitrix24ThreadId: data.bitrix24ThreadId }),
        ...(data.bitrix24ExternalChatId !== undefined && { bitrix24ExternalChatId: data.bitrix24ExternalChatId }),
        ...(data.assignedAgentId !== undefined && { assignedAgentId: data.assignedAgentId }),
        ...(data.closedAt !== undefined && { closedAt: data.closedAt }),
        ...(data.lastMessageAt !== undefined && { lastMessageAt: data.lastMessageAt }),
        ...(data.lastMessagePreview !== undefined && { lastMessagePreview: data.lastMessagePreview }),
        ...(data.lastMessageDirection !== undefined && { lastMessageDirection: data.lastMessageDirection }),
        ...(data.lastMessageType !== undefined && { lastMessageType: data.lastMessageType }),
        ...(data.unreadCount !== undefined && { unreadCount: data.unreadCount }),
      },
    });
  }

  /**
   * Updates the conversation snapshot after every message.
   * `incrementUnread` is true only for INCOMING messages.
   */
  async touchLastMessage(id, { direction, type, preview, at = new Date(), incrementUnread = false }) {
    const data = {
      lastMessageAt: at,
      lastMessageDirection: direction,
      lastMessageType: type,
      lastMessagePreview: preview ? preview.slice(0, 500) : null,
    };
    if (incrementUnread) data.unreadCount = { increment: 1 };
    return this.prisma.conversation.update({ where: { id }, data });
  }

  /** Marks a conversation as OPEN when new activity arrives. */
  async reopen(id) {
    return this.update(id, { status: 'OPEN', closedAt: null });
  }

  async close(id, closedAt = new Date()) {
    return this.update(id, { status: 'CLOSED', closedAt });
  }

  /**
   * List endpoint support with optional filters (status, assigned agent,
   * free-text contact search) and pagination. Returns contact info for
   * the UI and the latest message preview.
   */
  async list({ search = null, status = null, assignedAgentId = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (assignedAgentId) where.assignedAgentId = assignedAgentId;
    if (search) {
      where.OR = [
        { contact: { name: { contains: search } } },
        { contact: { firstName: { contains: search } } },
        { contact: { lastName: { contains: search } } },
        { contact: { whatsappPhone: { contains: search } } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: { contact: true, assignedAgent: { select: { id: true, name: true } } },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total };
  }

  async countByStatus() {
    const groups = await this.prisma.conversation.groupBy({
      by: ['status'],
      _count: true,
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count]));
  }

  async countOpen() {
    return this.prisma.conversation.count({ where: { status: 'OPEN' } });
  }
}

module.exports = { ConversationRepository };
