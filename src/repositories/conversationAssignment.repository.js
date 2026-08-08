const prismaClient = require('../database/prisma');

/**
 * Audit trail of who handled a conversation and when. `isActive` marks
 * the current owner; historical rows keep the full assignment log.
 */
class ConversationAssignmentRepository {
  constructor(prisma = prismaClient) {
    this.prisma = prisma;
  }

  async assign({ conversationId, agentId, assignedByAgentId = null }) {
    await this.prisma.conversationAssignment.updateMany({
      where: { conversationId, isActive: true },
      data: { isActive: false, unassignedAt: new Date() },
    });
    return this.prisma.conversationAssignment.create({
      data: { conversationId, agentId, assignedByAgentId },
    });
  }

  async unassign(conversationId, unassignedAt = new Date()) {
    return this.prisma.conversationAssignment.updateMany({
      where: { conversationId, isActive: true },
      data: { isActive: false, unassignedAt },
    });
  }

  async findActiveByConversation(conversationId) {
    return this.prisma.conversationAssignment.findFirst({
      where: { conversationId, isActive: true },
      include: { agent: { select: { id: true, name: true, bitrix24UserId: true } } },
    });
  }

  async listByConversation(conversationId) {
    return this.prisma.conversationAssignment.findMany({
      where: { conversationId },
      orderBy: { assignedAt: 'desc' },
      include: { agent: { select: { id: true, name: true } } },
    });
  }

  /**
   * The most recent active assignment for a contact across ALL of their
   * conversations. Used to keep the same customer on the same operator.
   */
  async findActiveByContact(contactId) {
    return this.prisma.conversationAssignment.findFirst({
      where: { isActive: true, conversation: { contactId } },
      orderBy: { assignedAt: 'desc' },
      include: { agent: true },
    });
  }

  /**
   * Per-agent routing stats over ACTIVE assignments:
   *   { agentId -> { load, lastAssignedAt } }
   * `load` is the count of currently open chats; `lastAssignedAt` is the
   * newest active assignment time (used as the round-robin / tie-break
   * key — absent for agents with no open chats, i.e. the "oldest").
   */
  async loadAndRecencyByAgent() {
    const rows = await this.prisma.conversationAssignment.groupBy({
      by: ['agentId'],
      where: { isActive: true },
      _count: { _all: true },
      _max: { assignedAt: true },
    });
    const map = new Map();
    for (const row of rows) {
      map.set(row.agentId, { load: row._count._all, lastAssignedAt: row._max.assignedAt });
    }
    return map;
  }
}

module.exports = { ConversationAssignmentRepository };
