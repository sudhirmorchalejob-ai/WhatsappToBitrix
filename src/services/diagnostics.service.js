const { env } = require('../config');
const { RetryOutgoingMessagesJob } = require('../jobs/retryOutgoingMessages.job');
const prismaClient = require('../database/prisma');
const {
  ContactRepository,
  ConversationRepository,
  MessageRepository,
  AgentRepository,
  WebhookLogRepository,
} = require('../repositories');

/**
 * Aggregated operational health + volumes for the admin dashboard.
 *
 * Every section is computed defensively: a failing repository call is
 * reported as an `{ error }` marker instead of taking the endpoint down,
 * so the diagnostics surface always answers even when a provider or the
 * DB is degraded.
 */
class DiagnosticsService {
  constructor({
    prisma = prismaClient,
    contactRepo = new ContactRepository(prisma),
    conversationRepo = new ConversationRepository(prisma),
    messageRepo = new MessageRepository(prisma),
    agentRepo = new AgentRepository(prisma),
    webhookLogRepo = new WebhookLogRepository(prisma),
    retryJob = new RetryOutgoingMessagesJob(),
  } = {}) {
    this.prisma = prisma;
    this.contactRepo = contactRepo;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.agentRepo = agentRepo;
    this.webhookLogRepo = webhookLogRepo;
    this.retryJob = retryJob;
  }

  async overview() {
    const maxRetries = env.OUTGOING_MAX_RETRIES;
    const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [db, contacts, conversations, messages, agents, webhooks] = await Promise.all([
      this._dbHealth(),
      this._section(() => this._contactStats()),
      this._section(() => this._conversationStats()),
      this._section(() => this._messageStats(maxRetries)),
      this._section(() => this._agentStats()),
      this._section(() => this.webhookLogRepo.countBySource({ source: 'WHATSBOX', from: lastDay })),
    ]);

    return {
      db,
      providers: this._providerStatus(),
      counts: {
        contacts,
        conversations,
        messages,
        agents,
        webhooks,
      },
      retry: {
        enabled: env.RETRY_ENABLED,
        maxRetries,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /** Manual kick of the retry sweep from the admin endpoint. */
  async runRetryNow({ limit = 50, maxRetries = env.OUTGOING_MAX_RETRIES, olderThanMinutes = 5 } = {}) {
    return this.retryJob.run({ limit, maxRetries, olderThanMinutes });
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  async _dbHealth() {
    const started = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _contactStats() {
    const bySyncStatus = await this.contactRepo.countBySyncStatus();
    return { total: Object.values(bySyncStatus).reduce((a, b) => a + b, 0), bySyncStatus };
  }

  async _conversationStats() {
    const [byStatus, open] = await Promise.all([
      this.conversationRepo.countByStatus(),
      this.conversationRepo.countOpen(),
    ]);
    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      open,
      byStatus,
    };
  }

  async _messageStats(maxRetries) {
    const [byStatus, byDirection, pendingOutgoing] = await Promise.all([
      this.messageRepo.countByStatus(),
      this.messageRepo.countByDirection(),
      this.messageRepo.countPendingOutgoing({ maxRetries }),
    ]);
    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      byDirection,
      pendingOutgoing,
    };
  }

  async _agentStats() {
    const total = await this.agentRepo.count();
    return { total };
  }

  _providerStatus() {
    return {
      whatsbox: {
        configured: Boolean(env.WHATSBOX_API_URL),
        channelConfigured: Boolean(env.WHATSBOX_CHANNEL_ID),
      },
      bitrix24: {
        configured: Boolean(env.BITRIX24_WEBHOOK_URL || env.BITRIX24_MEMBER_ID),
        oauth: Boolean(env.BITRIX24_CLIENT_ID && env.BITRIX24_CLIENT_SECRET),
      },
      webhookSecrets: {
        whatsbox: Boolean(env.WHATSBOX_WEBHOOK_SECRET),
        bitrix24: Boolean(env.BITRIX24_WEBHOOK_SECRET),
      },
    };
  }

  async _section(fn) {
    try {
      return await fn();
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = { DiagnosticsService };
