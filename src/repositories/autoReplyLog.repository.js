const prismaClient = require('../database/prisma');

/**
 * Audit trail of automatic replies. Used for once-per-contact/per-
 * conversation suppression and to attribute template usage.
 */
class AutoReplyLogRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  /**
   * Has this customer already received an auto-reply? With
   * `oncePerContact` the check spans all conversations (anti-spam);
   * otherwise it is scoped to the current conversation.
   */
  async hasAutoReplied({ contactId, conversationId, oncePerContact = true }) {
    const where = oncePerContact ? { contactId } : { conversationId };
    const count = await this.prisma.autoReplyLog.count({ where });
    return count > 0;
  }

  async record({ contactId, conversationId, messageId, templateId = null, body, tenantId = null }) {
    return this.prisma.autoReplyLog.create({
      data: { contactId, conversationId, messageId, templateId, body, tenantId },
    });
  }

  /**
   * Paged list of fired auto-replies, newest first, with the customer
   * contact and (when used) the reply template attached for display.
   */
  async list({ tenantId = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (tenantId) where.tenantId = Number(tenantId);

    const [items, total] = await Promise.all([
      this.prisma.autoReplyLog.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              whatsappPhone: true,
              name: true,
              firstName: true,
              lastName: true,
            },
          },
          template: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.autoReplyLog.count({ where }),
    ]);
    return { items, total };
  }
}

module.exports = { AutoReplyLogRepository };
