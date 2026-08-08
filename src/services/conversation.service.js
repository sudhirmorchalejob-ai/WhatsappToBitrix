const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const prismaClient = require('../database/prisma');
const { normalizePhone } = require('../helpers/phone');
const { MESSAGE_DIRECTION, MESSAGE_STATUS, CONVERSATION_STATUS, SYNC_STATUS, WEBHOOK_SOURCE } = require('../constants');
const { Bitrix24Service } = require('./bitrix24');
const {
  ContactRepository,
  ConversationRepository,
  MessageRepository,
  MessageStatusRepository,
  ConversationAssignmentRepository,
  AgentRepository,
} = require('../repositories');

const log = logger.childFor('conversation-service');

/**
 * Monotonic order for delivery states. FAILED is handled explicitly
 * because it can legitimately interrupt any other state.
 */
const STATUS_ORDER = {
  [MESSAGE_STATUS.PENDING]: 0,
  [MESSAGE_STATUS.SENT]: 1,
  [MESSAGE_STATUS.DELIVERED]: 2,
  [MESSAGE_STATUS.READ]: 3,
};

/**
 * Orchestration core. Encapsulates the "find-or-create" rules from the
 * spec (contact by phone, conversation per channel, open deal per
 * contact) plus the message persistence primitives. The webhook handlers
 * and outgoing-send controller all delegate here, so the business rules
 * live in exactly one place.
 *
 * Everything is injected in the constructor (defaults to the real
 * implementations) so tests can pass in-memory fakes and swap the
 * Bitrix24 service independently.
 */
class ConversationService {
  constructor({
    prisma = prismaClient,
    contactRepo = new ContactRepository(prisma),
    conversationRepo = new ConversationRepository(prisma),
    messageRepo = new MessageRepository(prisma),
    messageStatusRepo = new MessageStatusRepository(prisma),
    assignmentRepo = new ConversationAssignmentRepository(prisma),
    agentRepo = new AgentRepository(prisma),
    bitrix24 = new Bitrix24Service(),
  } = {}) {
    this.prisma = prisma;
    this.contactRepo = contactRepo;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.messageStatusRepo = messageStatusRepo;
    this.assignmentRepo = assignmentRepo;
    this.agentRepo = agentRepo;
    this.bitrix24 = bitrix24;
  }

  // ------------------------------------------------------------------
  // Contacts
  // ------------------------------------------------------------------

  /**
   * Find-or-create a Contact for a WhatsApp number.
   *
   * Rules (spec):
   *   phone exists  -> touch last seen, reuse
   *   else          -> search Bitrix24 by phone; if found, mirror it;
   *                    otherwise create locally first (the message must
   *                    never be dropped) and then sync to Bitrix24.
   *
   * Returns { contact, created, fromBitrix24 }.
   */
  async ensureContact({ phone, name = null, firstName = null, lastName = null, email = null, company = null, avatarUrl = null }) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new AppError('Invalid phone number', 400, null, 'INVALID_PHONE');
    }

    let contact = await this.contactRepo.findByWhatsappPhone(normalized);
    if (contact) {
      await this.contactRepo.touchLastActivity(contact.id, new Date());
      return { contact, created: false, fromBitrix24: false };
    }

    let b24Contact = null;
    try {
      b24Contact = await this.bitrix24.searchContactByPhone(normalized);
    } catch (err) {
      log.warn('B24 contact search failed; will attempt local + create', {
        phone: normalized,
        code: err.code,
        message: err.message,
      });
    }

    if (b24Contact && b24Contact.ID) {
      const b24Id = Number(b24Contact.ID);
      contact = await this.contactRepo.create({
        whatsappPhone: normalized,
        name: b24Contact.NAME || name,
        firstName: b24Contact.NAME || firstName,
        lastName: b24Contact.LAST_NAME || lastName,
        email: (b24Contact.EMAIL && b24Contact.EMAIL[0] && b24Contact.EMAIL[0].VALUE) || email,
        company: b24Contact.COMPANY_TITLE || company,
        bitrix24ContactId: b24Id,
        syncStatus: SYNC_STATUS.SYNCED,
      });
      await this.contactRepo.touchLastActivity(contact.id, new Date());
      return { contact, created: true, fromBitrix24: true };
    }

    // Not in the CRM yet — persist locally, then try to sync upward.
    contact = await this.contactRepo.create({
      whatsappPhone: normalized,
      name: name || firstName,
      firstName,
      lastName,
      email,
      company,
      avatarUrl,
      syncStatus: SYNC_STATUS.PENDING,
    });
    await this.contactRepo.touchLastActivity(contact.id, new Date());

    try {
      const b24Id = Number(
        await this.bitrix24.createContact({
          name: name || firstName || `+${normalized}`,
          lastName: lastName || undefined,
          phone: normalized,
          email: email || undefined,
          company: company || undefined,
        })
      );
      await this.contactRepo.markSynced(contact.id, b24Id);
      contact = await this.contactRepo.findById(contact.id);
    } catch (err) {
      log.warn('B24 contact creation failed; message stays local (retry job may sync later)', {
        contactId: contact.id,
        code: err.code,
        message: err.message,
      });
      await this.contactRepo.markSyncFailed(contact.id, { error: err.message, lastAttemptAt: new Date().toISOString() });
    }

    return { contact, created: true, fromBitrix24: false };
  }

  // ------------------------------------------------------------------
  // Conversations
  // ------------------------------------------------------------------

  /**
   * Find-or-create the conversation for (contact, channel). One open
   * chat per contact per WhatsApp number (unique composite key). The
   * channel's provider (WHATSBOX/META) and the Meta phone number id are
   * persisted so operator replies can be routed back over the same
   * provider the customer used.
   */
  async ensureConversation({ contactId, channelNumber, provider = WEBHOOK_SOURCE.WHATSBOX, phoneNumberId = null }) {
    const channel = normalizePhone(channelNumber) || String(channelNumber);

    let conversation = await this.conversationRepo.findByContactAndChannel(contactId, channel);
    if (conversation) {
      if (conversation.provider !== provider || (phoneNumberId && conversation.phoneNumberId !== phoneNumberId)) {
        conversation = await this.conversationRepo.update(conversation.id, { provider, phoneNumberId });
      }
      return { conversation, created: false };
    }

    conversation = await this.conversationRepo.create({
      contactId,
      channelNumber: channel,
      provider,
      phoneNumberId,
      status: CONVERSATION_STATUS.OPEN,
      lastMessageAt: new Date(),
    });
    return { conversation, created: true };
  }

  // ------------------------------------------------------------------
  // Deals
  // ------------------------------------------------------------------

  /**
   * Find-or-create an open deal for the contact's Bitrix24 record.
   *
   * Rules (spec):
   *   conversation already linked to an open deal -> reuse it
   *   contact has an open deal                     -> link + reuse
   *   otherwise                                    -> create a deal
   *
   * Failures are non-fatal: the WhatsApp message must still be stored
   * even if the CRM deal step fails. Returns { deal, created, skipped? }.
   */
  async ensureOpenDeal({ contact, conversation, firstMessageBody = null }) {
    if (conversation.dealId) {
      const existing = await this.bitrix24.getDeal(conversation.dealId).catch(() => null);
      if (existing && String(existing.CLOSED) !== 'Y') {
        return { deal: existing, created: false };
      }
      log.info('linked deal is closed or missing; searching for another open deal', {
        conversationId: conversation.id,
        dealId: conversation.dealId,
      });
    }

    if (!contact.bitrix24ContactId) {
      return { deal: null, created: false, skipped: 'contact-not-synced' };
    }

    const openDeal = await this.bitrix24
      .searchDealByContact(contact.bitrix24ContactId, { openOnly: true })
      .catch((err) => {
        log.warn('open-deal search failed', { contactId: contact.id, code: err.code, message: err.message });
        return null;
      });

    if (openDeal && openDeal.ID) {
      const dealId = Number(openDeal.ID);
      if (conversation.dealId !== dealId) {
        await this.conversationRepo.update(conversation.id, { dealId });
        conversation.dealId = dealId;
      }
      return { deal: openDeal, created: false };
    }

    try {
      const assignedById = await this._resolveAgentB24Id(conversation.assignedAgentId);
      const dealId = Number(
        await this.bitrix24.createDeal({
          title: this._dealTitle(contact, conversation.channelNumber),
          contactId: contact.bitrix24ContactId,
          assignedById,
          comments: firstMessageBody
            ? `First WhatsApp message: ${String(firstMessageBody).slice(0, 900)}`
            : undefined,
        })
      );
      await this.conversationRepo.update(conversation.id, { dealId });
      conversation.dealId = dealId;
      return { deal: { ID: String(dealId) }, created: true };
    } catch (err) {
      log.error('deal creation failed; message still stored', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
      return { deal: null, created: false, skipped: 'deal-create-failed' };
    }
  }

  async _resolveAgentB24Id(agentId) {
    if (!agentId) return undefined;
    const agent = await this.agentRepo.findById(agentId);
    return agent ? agent.bitrix24UserId : undefined;
  }

  _dealTitle(contact, channelNumber) {
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    const label = fullName || contact.name || `+${contact.whatsappPhone}`;
    return `WhatsApp — ${label}`.slice(0, 255);
  }

  // ------------------------------------------------------------------
  // Message persistence
  // ------------------------------------------------------------------

  /**
   * Persists a message and updates the conversation snapshot + contact
   * last-seen in one logical step. `incrementUnread` is derived from the
   * direction (incoming only).
   */
  async saveMessage({
    conversation,
    contact,
    dealId = null,
    direction,
    type,
    body = null,
    caption = null,
    mediaUrl = null,
    mediaMimeType = null,
    mediaName = null,
    mediaSize = null,
    locationData = null,
    contactCard = null,
    whatsboxMessageId = null,
    wamid = null,
    payload = null,
    timestamp = new Date(),
    status = MESSAGE_STATUS.PENDING,
  }) {
    const message = await this.messageRepo.create({
      conversationId: conversation.id,
      contactId: contact.id,
      dealId: dealId ?? conversation.dealId ?? null,
      whatsboxMessageId,
      wamid,
      payload,
      direction,
      type,
      body,
      caption,
      mediaUrl,
      mediaMimeType,
      mediaName,
      mediaSize,
      locationData,
      contactCard,
      timestamp,
      status,
    });

    const isIncoming = direction === MESSAGE_DIRECTION.INCOMING;
    await this.conversationRepo.touchLastMessage(conversation.id, {
      direction,
      type,
      preview: body || caption || mediaName || `[${type}]`,
      at: timestamp,
      incrementUnread: isIncoming,
    });
    await this.contactRepo.touchLastActivity(contact.id, timestamp);

    return message;
  }

  /**
   * Appends a status-history row and forwards the message state. State
   * transitions are monotonic (PENDING < SENT < DELIVERED < READ); FAILED
   * may replace any state. Stale/duplicate status events still get an
   * audit row but do not move the message backwards.
   */
  async recordMessageStatus({ messageId, status, providerStatus = null, error = null, raw = null, timestamp = new Date() }) {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404, null, 'MESSAGE_NOT_FOUND');
    }

    await this.messageStatusRepo.create({
      messageId,
      status,
      providerStatus,
      attempt: message.retryCount + 1,
      error,
      raw,
      timestamp,
    });

    const currentRank = STATUS_ORDER[message.status] ?? -1;
    const newRank = STATUS_ORDER[status];
    const isFailure = status === MESSAGE_STATUS.FAILED;
    // FAILED only applies while the message is still pending/sent; a
    // message that was already delivered or read is terminal, so a late
    // failure callback is logged but cannot regress the state.
    const failureAllowed = isFailure && currentRank <= STATUS_ORDER[MESSAGE_STATUS.SENT];
    const forward = newRank != null && newRank > currentRank;

    if (failureAllowed || forward) {
      return this.messageRepo.updateStatus(messageId, status, { error });
    }
    return message;
  }

  /** Backfills the provider/CRM message ids after a successful send. */
  async updateOutgoingMessageId({ id, whatsboxMessageId = null, wamid = null }) {
    return this.messageRepo.update(id, { whatsboxMessageId, wamid });
  }

  /** Mirrors a Bitrix24 user row into the local agents cache. */
  async syncAgent(user) {
    return this.agentRepo.upsertFromBitrix24(user);
  }
}

module.exports = { ConversationService };
