const prismaClient = require('../database/prisma');

/**
 * Append-only status history for a message (sent -> delivered -> read /
 * failed). Each provider status update writes a new row so we keep the
 * full timeline for diagnostics.
 */
class MessageStatusRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async create({ messageId, status, providerStatus = null, attempt = 1, error = null, raw = null, timestamp = new Date() }) {
    return this.prisma.messageStatus.create({
      data: { messageId, status, providerStatus, attempt, error, raw, timestamp },
    });
  }

  async listByMessage(messageId) {
    return this.prisma.messageStatus.findMany({
      where: { messageId },
      orderBy: { timestamp: 'asc' },
    });
  }
}

module.exports = { MessageStatusRepository };
