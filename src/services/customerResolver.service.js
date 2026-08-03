const logger = require('../utils/logger');
const { ConversationService } = require('./conversation.service');

const log = logger.childFor('customer-resolver-service');

/**
 * Centralized service for resolving & ensuring unique Customers (Contacts)
 * and Leads (Deals) across all messaging workflows:
 *   - Incoming WhatsApp Webhook events
 *   - Outgoing / Campaign broadcast messages
 *   - Automated messages (Auto-replies, welcome/away responses)
 *
 * Enforces strict phone-number-based uniqueness to prevent duplicate
 * contacts and leads.
 */
class CustomerResolverService {
  constructor({ conversationService = new ConversationService() } = {}) {
    this.conversationService = conversationService;
  }

  /**
   * Resolves existing Customer & Lead records or creates missing ones.
   * Used by ALL inbound message workflows (webhook handlers) where we
   * always want a contact + conversation + open deal in one step.
   *
   * @param {Object} input
   * @param {string} input.phone Customer WhatsApp phone number
   * @param {string} [input.name] Customer display name
   * @param {string} [input.channelNumber] WhatsApp channel / business phone number
   * @param {string} [input.provider] 'WHATSBOX' or 'META'
   * @param {string} [input.phoneNumberId] Meta phone number ID (if applicable)
   * @param {string} [input.firstMessageBody] Message text snippet for deal context
   * @returns {Promise<{ contact, conversation, deal, contactCreated, dealCreated }>}
   */
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
  }) {
    if (!phone) {
      throw new Error('Phone number is required to resolve customer and lead');
    }

    const { contact, created: contactCreated } = await this.conversationService.ensureContact({
      phone,
      name,
      firstName,
      lastName,
      email,
      company,
      avatarUrl,
    });

    const { conversation } = await this.conversationService.ensureConversation({
      contactId: contact.id,
      channelNumber: channelNumber || phone,
      provider,
      phoneNumberId,
    });

    const { deal, created: dealCreated } = await this.conversationService.ensureOpenDeal({
      contact,
      conversation,
      firstMessageBody,
    });

    log.info('resolved customer and lead', {
      contactId: contact.id,
      contactCreated,
      conversationId: conversation.id,
      dealId: deal ? Number(deal.ID) : null,
      dealCreated,
    });

    return { contact, conversation, deal, contactCreated, dealCreated };
  }

  /**
   * Resolves existing Customer (Contact) + Conversation ONLY — no deal.
   * Used by outgoing/campaign message workflows where the deal step is
   * handled separately (explicit dealId wins; _resolveDealId runs after).
   *
   * @param {Object} input
   * @param {string} input.phone
   * @param {string} [input.name]
   * @param {string} [input.channelNumber]
   * @param {string} [input.provider]
   * @param {string} [input.phoneNumberId]
   * @returns {Promise<{ contact, conversation, contactCreated }>}
   */
  async resolveCustomer({
    phone,
    name = null,
    channelNumber = null,
    provider = 'WHATSBOX',
    phoneNumberId = null,
  }) {
    if (!phone) {
      throw new Error('Phone number is required to resolve customer');
    }

    const { contact, created: contactCreated } = await this.conversationService.ensureContact({
      phone,
      name,
    });

    const { conversation } = await this.conversationService.ensureConversation({
      contactId: contact.id,
      channelNumber: channelNumber || phone,
      provider,
      phoneNumberId,
    });

    log.info('resolved customer', {
      contactId: contact.id,
      contactCreated,
      conversationId: conversation.id,
    });

    return { contact, conversation, contactCreated };
  }
}

module.exports = { CustomerResolverService };
