const logger = require('../utils/logger');
const { ConversationService } = require('./conversation.service');

const log = logger.childFor('customer-resolver-service');

class CustomerResolverService {
  constructor({ conversationService = new ConversationService() } = {}) {
    this.conversationService = conversationService;
  }

  async resolveCustomerAndLead({
    phone,
    name = null,
    firstName = null,
    lastName = null,
    email = null,
    company = null,
    avatarUrl = null,
    channelNumber = null,
    provider = 'WHATSBOX',
    phoneNumberId = null,
    firstMessageBody = null,
    tenantId = null,
  }) {
    if (!phone) {
      throw new Error('Phone number is required to resolve customer and lead');
    }

    const contactPayload = {
      phone,
      name,
      firstName,
      lastName,
      email,
      company,
      avatarUrl,
    };
    if (tenantId !== null && tenantId !== undefined) {
      contactPayload.tenantId = tenantId;
    }

    const { contact, created: contactCreated } = await this.conversationService.ensureContact(contactPayload);

    const convPayload = {
      contactId: contact.id,
      channelNumber: channelNumber || phone,
      provider,
      phoneNumberId,
    };
    if (tenantId !== null && tenantId !== undefined) {
      convPayload.tenantId = tenantId;
    }

    const { conversation } = await this.conversationService.ensureConversation(convPayload);

    const leadPayload = {
      contact,
      conversation,
      firstMessageBody,
    };
    if (tenantId !== null && tenantId !== undefined) {
      leadPayload.tenantId = tenantId;
    }

    const { lead, created: leadCreated } = await this.conversationService.ensureOpenLead(leadPayload);

    log.info('resolved customer and lead', {
      contactId: contact.id,
      contactCreated,
      conversationId: conversation.id,
      leadId: lead ? Number(lead.ID) : null,
      leadCreated,
      tenantId,
    });

    return { contact, conversation, lead, contactCreated, leadCreated };
  }

  async resolveCustomer({
    phone,
    name = null,
    channelNumber = null,
    provider = 'WHATSBOX',
    phoneNumberId = null,
    tenantId = null,
  }) {
    if (!phone) {
      throw new Error('Phone number is required to resolve customer');
    }

    const contactPayload = {
      phone,
      name,
    };
    if (tenantId !== null && tenantId !== undefined) {
      contactPayload.tenantId = tenantId;
    }

    const { contact, created: contactCreated } = await this.conversationService.ensureContact(contactPayload);

    const convPayload = {
      contactId: contact.id,
      channelNumber: channelNumber || phone,
      provider,
      phoneNumberId,
    };
    if (tenantId !== null && tenantId !== undefined) {
      convPayload.tenantId = tenantId;
    }

    const { conversation } = await this.conversationService.ensureConversation(convPayload);

    log.info('resolved customer', {
      contactId: contact.id,
      contactCreated,
      conversationId: conversation.id,
      tenantId,
    });

    return { contact, conversation, contactCreated };
  }
}

module.exports = { CustomerResolverService };
