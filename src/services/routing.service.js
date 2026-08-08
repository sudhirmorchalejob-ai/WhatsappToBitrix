const { env } = require('../config');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { ROUTING_STRATEGY, AGENT_ROLE } = require('../constants');
const {
  AgentRepository,
  ConversationAssignmentRepository,
  ConversationRepository,
} = require('../repositories');

const log = logger.childFor('routing');

/**
 * Operator routing (Phase 6).
 *
 * Decides which operator owns an incoming conversation:
 *  1. an existing assignment is kept,
 *  2. a returning customer is routed back to the same operator
 *     (contact-level active assignment reuse),
 *  3. otherwise the next free operator is picked by strategy
 *     (least-loaded or round-robin/LRU), skipping supervisors and agents
 *     already at their cap.
 *
 * Supervisors are excluded from auto-assignment by default but can take
 * over via the manual assign endpoint. Every side-effect is defensive:
 * routing failures must never drop a WhatsApp message.
 */
class RoutingService {
  constructor({
    agentRepo = new AgentRepository(),
    assignmentRepo = new ConversationAssignmentRepository(),
    conversationRepo = new ConversationRepository(),
  } = {}) {
    this.agentRepo = agentRepo;
    this.assignmentRepo = assignmentRepo;
    this.conversationRepo = conversationRepo;
  }

  /**
   * Auto-assigns an unassigned conversation. Returns a summary
   * { assigned, reason, agentId?, agent? } — never throws.
   */
  async assignIfNeeded({ conversation, contact = null, byUserId = null }) {
    if (!conversation || !conversation.id) {
      return { assigned: false, reason: 'no-conversation' };
    }

    if (conversation.assignedAgentId) {
      return { assigned: false, reason: 'already-assigned', agentId: conversation.assignedAgentId };
    }

    if (!env.ROUTING_ENABLED) {
      return { assigned: false, reason: 'routing-disabled' };
    }

    // Manual takeover (byUserId) wins over auto-routing.
    if (byUserId) {
      const manual = await this._resolveAgent(byUserId);
      if (!manual) return { assigned: false, reason: 'by-agent-inactive-or-missing' };
      await this.assign({ conversationId: conversation.id, agentId: manual.id, byUserId });
      return { assigned: true, agentId: manual.id, reason: 'manual', agent: manual };
    }

    // Keep the same operator for a returning customer.
    if (contact && contact.id) {
      const existing = await this.assignmentRepo.findActiveByContact(contact.id).catch(() => null);
      if (existing && existing.agent && existing.agent.isActive) {
        await this.assign({ conversationId: conversation.id, agentId: existing.agent.id });
        return { assigned: true, agentId: existing.agent.id, reason: 'contact-reuse', agent: existing.agent };
      }
    }

    const agents = await this.agentRepo.listActive().catch(() => []);
    if (!agents.length) return { assigned: false, reason: 'no-agents' };

    const stats = await this.assignmentRepo.loadAndRecencyByAgent().catch(() => new Map());

    const picked = this.pickAgent({
      agents,
      stats,
      strategy: env.ROUTING_STRATEGY,
      excludeSupervisors: env.ROUTING_EXCLUDE_SUPERVISORS,
      maxActive: env.ROUTING_MAX_ACTIVE_PER_AGENT,
    });
    if (!picked) return { assigned: false, reason: 'no-eligible-agents' };

    await this.assign({ conversationId: conversation.id, agentId: picked.id });
    return { assigned: true, agentId: picked.id, reason: 'auto', agent: picked };
  }

  /**
   * Pure selection logic. Returns the chosen agent or null.
   *   round-robin    -> agent whose newest open chat is oldest (LRU)
   *   least-loaded   -> fewest open chats, LRU as tie-break
   * Agents already at `maxActive` are skipped unless every candidate is.
   */
  pickAgent({
    agents = [],
    stats = new Map(),
    strategy = ROUTING_STRATEGY.LEAST_LOADED,
    excludeSupervisors = true,
    maxActive = 100,
  }) {
    let candidates = agents.filter((a) => a && a.isActive && !(excludeSupervisors && a.isSupervisor));
    if (!candidates.length) return null;

    const eligible = candidates.filter((a) => (stats.get(a.id)?.load ?? 0) < maxActive);
    if (eligible.length) candidates = eligible;

    const score = (a) => ({
      load: stats.get(a.id)?.load ?? 0,
      recency: stats.get(a.id)?.lastAssignedAt?.getTime() ?? -Infinity,
    });

    candidates.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (strategy === ROUTING_STRATEGY.ROUND_ROBIN) {
        return sa.recency - sb.recency;
      }
      if (sa.load !== sb.load) return sa.load - sb.load;
      return sa.recency - sb.recency;
    });

    return candidates[0] || null;
  }

  /** Assigns a conversation to an agent (manual or routed). Throws on bad input. */
  async assign({ conversationId, agentId, byUserId = null }) {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 404, null, 'AGENT_NOT_FOUND');
    if (!agent.isActive) throw new AppError('Agent is not active', 400, null, 'AGENT_INACTIVE');

    await this.conversationRepo.update(conversationId, { assignedAgentId: agentId });
    const assignment = await this.assignmentRepo.assign({ conversationId, agentId, assignedByAgentId: byUserId });

    log.info('conversation assigned', { conversationId, agentId, byUserId });
    return { agent, assignment };
  }

  /**
   * Manual assign/takeover by Bitrix24 user id (what an operator passes
   * from the app). Resolves the local agent and assigns, allowing a
   * takeover of an already-assigned conversation. Throws AppError.
   */
  async assignByUser({ conversationId, byUserId }) {
    if (!byUserId) {
      throw new AppError('byUserId is required', 400, null, 'BY_USER_ID_REQUIRED');
    }
    const agent = await this.agentRepo.findByBitrix24Id(byUserId).catch(() => null);
    if (!agent) throw new AppError('Agent not found for Bitrix24 user', 404, null, 'AGENT_NOT_FOUND');
    return this.assign({ conversationId, agentId: agent.id, byUserId });
  }

  /** Clears the assignment and closes the active audit row. */
  async unassign({ conversationId, byUserId = null }) {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) throw new AppError('Conversation not found', 404, null, 'CONVERSATION_NOT_FOUND');

    await this.assignmentRepo.unassign(conversationId);
    await this.conversationRepo.update(conversationId, { assignedAgentId: null });

    log.info('conversation unassigned', { conversationId, byUserId });
    return { conversationId, unassigned: true };
  }

  /** Active operators with their current load, for the agents API. */
  async listAgents() {
    const agents = await this.agentRepo.listActive();
    const stats = await this.assignmentRepo.loadAndRecencyByAgent().catch(() => new Map());
    return agents.map((a) => ({
      id: a.id,
      bitrix24UserId: a.bitrix24UserId,
      name: a.name,
      email: a.email,
      role: a.isSupervisor ? AGENT_ROLE.SUPERVISOR : AGENT_ROLE.OPERATOR,
      isSupervisor: a.isSupervisor,
      openChats: stats.get(a.id)?.load ?? 0,
      lastAssignedAt: stats.get(a.id)?.lastAssignedAt ?? null,
    }));
  }

  async _resolveAgent(byUserId) {
    const agent = await this.agentRepo.findByBitrix24Id(byUserId).catch(() => null);
    if (!agent || !agent.isActive) return null;
    return agent;
  }
}

module.exports = { RoutingService };
