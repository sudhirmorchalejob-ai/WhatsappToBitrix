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

const STATUS_ORDER = {
  [MESSAGE_STATUS.PENDING]: 0,
  [MESSAGE_STATUS.SENT]: 1,
  [MESSAGE_STATUS.DELIVERED]: 2,
  [MESSAGE_STATUS.READ]: 3,
};

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

  async ensureContact({ phone, name = null, firstName = null, lastName = null, email = null, company = null, avatarUrl = null, tenantId = null }) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new AppError('Invalid phone number', 400, null, 'INVALID_PHONE');
    }

    let contact = await this.contactRepo.findByWhatsappPhone(normalized, tenantId);
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

    const baseData = {
      whatsappPhone: normalized,
      name: (b24Contact && b24Contact.NAME) || name,
      firstName: (b24Contact && b24Contact.NAME) || firstName,
      lastName: (b24Contact && b24Contact.LAST_NAME) || lastName,
      email: (b24Contact && b24Contact.EMAIL && b24Contact.EMAIL[0] && b24Contact.EMAIL[0].VALUE) || email,
      company: (b24Contact && b24Contact.COMPANY_TITLE) || company,
      avatarUrl,
    };
    if (tenantId !== null && tenantId !== undefined) {
      baseData.tenantId = Number(tenantId);
    }

    if (b24Contact && b24Contact.ID) {
      const b24Id = Number(b24Contact.ID);
      contact = await this.contactRepo.create({
        ...baseData,
        bitrix24ContactId: b24Id,
        syncStatus: SYNC_STATUS.SYNCED,
      });
      await this.contactRepo.touchLastActivity(contact.id, new Date());
      return { contact, created: true, fromBitrix24: true };
    }

    contact = await this.contactRepo.create({
      ...baseData,
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
      log.warn('B24 contact creation failed; message stays local', {
        contactId: contact.id,
        code: err.code,
        message: err.message,
      });
      await this.contactRepo.markSyncFailed(contact.id, { error: err.message, lastAttemptAt: new Date().toISOString() });
    }

    return { contact, created: true, fromBitrix24: false };
  }

  async ensureConversation({ contactId, channelNumber, provider = WEBHOOK_SOURCE.WHATSBOX, phoneNumberId = null, tenantId = null }) {
    const channel = normalizePhone(channelNumber) || String(channelNumber);

    let conversation = await this.conversationRepo.findByContactAndChannel(contactId, channel, tenantId);
    if (conversation) {
      if (conversation.provider !== provider || (phoneNumberId && conversation.phoneNumberId !== phoneNumberId)) {
        conversation = await this.conversationRepo.update(conversation.id, { provider, phoneNumberId });
      }
      return { conversation, created: false };
    }

    const createPayload = {
      contactId: Number(contactId),
      channelNumber: channel,
      provider,
      phoneNumberId,
      status: CONVERSATION_STATUS.OPEN,
      lastMessageAt: new Date(),
    };
    if (tenantId !== null && tenantId !== undefined) {
      createPayload.tenantId = Number(tenantId);
    }

    conversation = await this.conversationRepo.create(createPayload);
    return { conversation, created: true };
  }

  async ensureOpenLead({ contact, conversation, firstMessageBody = null }) {
    if (conversation.leadId) {
      const existing = await this.bitrix24.getLead(conversation.leadId).catch(() => null);
      if (existing && String(existing.CLOSED) !== 'Y') {
        return { lead: existing, created: false };
      }
    }

    if (!contact.bitrix24ContactId) {
      return { lead: null, created: false, skipped: 'contact-not-synced' };
    }

    const openLead = await this.bitrix24
      .searchLeadByContact(contact.bitrix24ContactId, { openOnly: true })
      .catch((err) => {
        log.warn('open-lead search failed', { contactId: contact.id, code: err.code, message: err.message });
        return null;
      });

    if (openLead && openLead.ID) {
      const leadId = Number(openLead.ID);
      if (conversation.leadId !== leadId) {
        await this.conversationRepo.update(conversation.id, { leadId });
        conversation.leadId = leadId;
      }
      return { lead: openLead, created: false };
    }

    try {
      const assignedById = await this._resolveAgentB24Id(conversation.assignedAgentId);
      const leadId = Number(
        await this.bitrix24.createLead({
          title: this._leadTitle(contact, conversation.channelNumber),
          contactId: contact.bitrix24ContactId,
          assignedById,
          comments: firstMessageBody
            ? `First WhatsApp message: ${String(firstMessageBody).slice(0, 900)}`
            : undefined,
        })
      );
      await this.conversationRepo.update(conversation.id, { leadId });
      conversation.leadId = leadId;
      return { lead: { ID: String(leadId) }, created: true };
    } catch (err) {
      log.error('lead creation failed; message still stored', {
        conversationId: conversation.id,
        code: err.code,
        message: err.message,
      });
      return { lead: null, created: false, skipped: 'lead-create-failed' };
    }
  }

  async syncAgent(b24User, tenantId = null) {
    if (!b24User || (!b24User.ID && !b24User.id)) return null;
    return this.agentRepo.upsertFromBitrix24(b24User, tenantId);
  }

  async _resolveAgentB24Id(agentId) {
    if (!agentId) return undefined;
    const agent = await this.agentRepo.findById(agentId);
    return agent ? agent.bitrix24UserId : undefined;
  }

  _leadTitle(contact, channelNumber) {
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    const label = fullName || contact.name || `+${contact.whatsappPhone}`;
    return `WhatsApp — ${label}`.slice(0, 255);
  }

  async saveMessage({
    conversation,
    contact,
    leadId = null,
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
    tenantId = null,
  }) {
    const activeTenantId = tenantId !== null && tenantId !== undefined
      ? tenantId
      : (conversation && conversation.tenantId ? conversation.tenantId : null);

    const activeLeadId = leadId !== null && leadId !== undefined
      ? leadId
      : (conversation ? conversation.leadId : null);

    const createPayload = {
      conversationId: conversation.id,
      contactId: contact.id,
      leadId: activeLeadId,
      whatsboxMessageId,
      wamid,
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
      payload,
      timestamp,
      status,
    };
    if (activeTenantId !== null && activeTenantId !== undefined) {
      createPayload.tenantId = Number(activeTenantId);
    }

    const message = await this.messageRepo.create(createPayload);

    await this.messageStatusRepo.create({
      messageId: message.id,
      status,
      timestamp,
    });

    const preview = body || caption || mediaName || type;
    await this.conversationRepo.touchLastMessage(conversation.id, {
      direction,
      type,
      preview,
      at: timestamp,
      incrementUnread: direction === MESSAGE_DIRECTION.INCOMING,
    });

    await this.contactRepo.touchLastActivity(contact.id, timestamp);

    return message;
  }

  async updateOutgoingMessageId({ id, whatsboxMessageId = null, wamid = null }) {
    return this.messageRepo.update(id, {
      ...(whatsboxMessageId && { whatsboxMessageId }),
      ...(wamid && { wamid }),
    });
  }

  async recordMessageStatus({ messageId, status, providerStatus = null, error = null, raw = null, timestamp = new Date() }) {
    const existing = await this.messageRepo.findById(messageId);
    if (!existing) {
      log.warn('message status dropped: row not found', { messageId, status });
      throw new AppError('Message not found', 404, null, 'MESSAGE_NOT_FOUND');
    }

    const currentOrd = STATUS_ORDER[existing.status] ?? -1;
    const targetOrd = STATUS_ORDER[status] ?? -1;

    let shouldUpdateMain = false;
    if (existing.status === MESSAGE_STATUS.READ || existing.status === MESSAGE_STATUS.DELIVERED) {
      if (status === MESSAGE_STATUS.FAILED || targetOrd <= currentOrd) {
        shouldUpdateMain = false;
      }
    } else if (status === MESSAGE_STATUS.FAILED || targetOrd > currentOrd) {
      shouldUpdateMain = true;
    }

    if (shouldUpdateMain) {
      const opts = { error };
      if (status === MESSAGE_STATUS.SENT && !existing.sentAt) opts.sentAt = timestamp;
      await this.messageRepo.updateStatus(messageId, status, opts);
    }

    await this.messageStatusRepo.create({
      messageId,
      status,
      providerStatus,
      error,
      raw,
      timestamp,
    });

    return this.messageRepo.findById(messageId);
  }
}

module.exports = { ConversationService };
