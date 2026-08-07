const logger = require('../utils/logger');
const { normalizePhone } = require('../helpers/phone');
const { CAMPAIGN_B24_SOURCE_ID } = require('./segmentResolver.service');
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
    campaignId = null,
    campaignContext = null,
    conversationId = null,
    tenantId = null,
  }) {
    if (!phone) {
      throw new Error('Phone number is required to resolve customer and lead');
    }

    // Campaign replies thread back into the conversation the campaign
    // message was sent from (matched by phone in the handler). Reusing it
    // avoids duplicate contacts/conversations and keeps the chat history
    // (and its lead) in one place.
    if (conversationId) {
      const existingConversation = await this.conversationService.conversationRepo.findById(conversationId);
      if (existingConversation) {
        const conversation = existingConversation;
        const contact = conversation.contact;
        if (campaignId && !conversation.campaignId) {
          await this.conversationService.conversationRepo.update(conversation.id, { campaignId: Number(campaignId) });
          conversation.campaignId = Number(campaignId);
        }
        const leadPayload = {
          contact,
          conversation,
          firstMessageBody,
          ...this._leadContext(campaignContext, contact),
        };
        if (tenantId !== null && tenantId !== undefined) {
          leadPayload.tenantId = tenantId;
        }
        const { lead, created: leadCreated } = await this.conversationService.ensureOpenLead(leadPayload);
        log.info('resolved customer via campaign conversation', {
          contactId: contact.id,
          conversationId: conversation.id,
          leadId: lead ? Number(lead.ID) : null,
          leadCreated,
          campaignId,
          tenantId,
        });
        return { contact, conversation, lead, contactCreated: false, leadCreated };
      }
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
      campaignId,
    };
    if (tenantId !== null && tenantId !== undefined) {
      convPayload.tenantId = tenantId;
    }

    const { conversation } = await this.conversationService.ensureConversation(convPayload);

    const leadPayload = {
      contact,
      conversation,
      firstMessageBody,
      ...this._leadContext(campaignContext, contact),
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
      campaignId,
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
    campaignId = null,
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
      campaignId,
    };
    if (tenantId !== null && tenantId !== undefined) {
      convPayload.tenantId = tenantId;
    }

    const { conversation } = await this.conversationService.ensureConversation(convPayload);

    log.info('resolved customer', {
      contactId: contact.id,
      contactCreated,
      conversationId: conversation.id,
      campaignId,
      tenantId,
    });

    return { contact, conversation, contactCreated };
  }

  /**
   * Builds Bitrix24 lead attribution for a campaign contact. Applied only
   * when the message is matched to a campaign, so leads created by
   * campaign traffic carry the campaign name/source.
   */
  _leadContext(campaignContext, contact) {
    if (!campaignContext || !campaignContext.campaignName) return {};
    const label = contact.name || contact.firstName || `+${contact.whatsappPhone}`;
    return {
      leadTitle: `Campaign: ${String(campaignContext.campaignName).slice(0, 100)} — ${label}`.slice(0, 255),
      sourceId: CAMPAIGN_B24_SOURCE_ID,
      comments: `Sent via WhatsApp campaign "${campaignContext.campaignName}".`,
    };
  }
}

module.exports = { CustomerResolverService };
