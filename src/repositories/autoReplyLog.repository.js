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

  async record({ contactId, conversationId, messageId, templateId = null, body }) {
    return this.prisma.autoReplyLog.create({
      data: { contactId, conversationId, messageId, templateId, body },
    });
  }
}

module.exports = { AutoReplyLogRepository };
