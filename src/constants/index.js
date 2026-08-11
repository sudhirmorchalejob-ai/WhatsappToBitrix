/**
 * Shared constants. Database enums (Prisma) must mirror these values.
 */

const MESSAGE_DIRECTION = Object.freeze({
  INCOMING: 'INCOMING',
  OUTGOING: 'OUTGOING',
});

const MESSAGE_TYPE = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  VOICE: 'VOICE',
  DOCUMENT: 'DOCUMENT',
  PDF: 'PDF',
  LOCATION: 'LOCATION',
  CONTACT: 'CONTACT',
  STICKER: 'STICKER',
  UNKNOWN: 'UNKNOWN',
});

const MESSAGE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
});

const CONVERSATION_STATUS = Object.freeze({
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  CLOSED: 'CLOSED',
});

const SYNC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
});

const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
});

const CAMPAIGN_TYPE = Object.freeze({
  TEXT: 'TEXT',
  MEDIA: 'MEDIA',
});

const PROVIDER = Object.freeze({
  WHATSAPP: 'WHATSAPP',
  BITRIX24: 'BITRIX24',
});

const WEBHOOK_SOURCE = Object.freeze({
  WHATSBOX: 'WHATSBOX',
  META: 'META',
  BITRIX24: 'BITRIX24',
});

const WEBHOOK_LOG_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
});

/**
 * Operator routing strategies for auto-assigning incoming chats.
 */
const ROUTING_STRATEGY = Object.freeze({
  LEAST_LOADED: 'least-loaded',
  ROUND_ROBIN: 'round-robin',
});

/**
 * Agent roles. `isSupervisor` on the Agent row is the source of truth;
 * this maps it to a human label for the API.
 */
const AGENT_ROLE = Object.freeze({
  OPERATOR: 'operator',
  SUPERVISOR: 'supervisor',
});

/**
 * Bitrix24 REST method names (module 3 implements the client).
 */
const BITRIX24_METHODS = Object.freeze({
  // Contacts
  CONTACT_GET: 'crm.contact.get',
  CONTACT_LIST: 'crm.contact.list',
  CONTACT_ADD: 'crm.contact.add',
  CONTACT_UPDATE: 'crm.contact.update',
  DUPLICATE_FIND: 'crm.duplicate.findbycomm',

  // Leads
  LEAD_GET: 'crm.lead.get',
  LEAD_LIST: 'crm.lead.list',
  LEAD_ADD: 'crm.lead.add',
  LEAD_UPDATE: 'crm.lead.update',

  // Deals
  DEAL_GET: 'crm.deal.get',
  DEAL_LIST: 'crm.deal.list',
  DEAL_ADD: 'crm.deal.add',
  DEAL_UPDATE: 'crm.deal.update',

  // Companies
  COMPANY_GET: 'crm.company.get',
  COMPANY_LIST: 'crm.company.list',
  COMPANY_ADD: 'crm.company.add',
  COMPANY_UPDATE: 'crm.company.update',

  // Timeline
  TIMELINE_COMMENT_ADD: 'crm.timeline.comment.add',

  // Activities
  ACTIVITY_ADD: 'crm.activity.add',

  // User
  USER_GET: 'user.get',
  NOTIFY_ADD: 'im.notify.add',

  // Files
  FILE_UPLOAD: 'disk.folder.uploadfile',

  // Marketplace app
  APP_INFO: 'app.info',
  EVENT_BIND: 'event.bind',
  EVENT_UNBIND: 'event.unbind',
  PLACEMENT_BIND: 'placement.bind',

  // Open Channels (imconnector)
  IMCONNECTOR_REGISTER: 'imconnector.register',
  IMCONNECTOR_ACTIVATE: 'imconnector.activate',
  IMCONNECTOR_CONNECTOR_DATA_SET: 'imconnector.connector.data.set',
  IMCONNECTOR_SEND_MESSAGES: 'imconnector.send.messages',
  IMCONNECTOR_SEND_STATUS_DELIVERY: 'imconnector.send.status.delivery',

  // Batch
  BATCH: 'batch',
});

/**
 * Bitrix24 app/CRM events the middleware registers via event.bind.
 */
const BITRIX24_EVENTS = Object.freeze({
  APP_INSTALL: 'ONAPPINSTALL',
  APP_UNINSTALL: 'ONAPPUNINSTALL',
  OPENLINE_MESSAGE_NEW: 'ONIMOPENLINEMESSAGENEW',
  OPENLINE_MESSAGE_UPDATE: 'ONIMOPENLINEMESSAGEUPDATE',
  CONNECTOR_MESSAGE_ADD: 'ONIMCONNECTORMESSAGEADD',
  CONNECTOR_MESSAGE_UPDATE: 'ONIMCONNECTORMESSAGEUPDATE',
  // Lead created. App event code for event.bind; the portal delivers the
  // payload with event "ONCRMLEADADD" (data.FIELDS.ID = new lead id).
  CRM_LEAD_ADD: 'ONCRMLEADADD',
});

/**
 * Marker prefix used on Bitrix24 lead titles to flag a lead as the CRM
 * mirror of a WhatsApp marketing campaign. Set when pushing campaigns
 * from the WhatsApp dashboard and recognised when receiving crm.lead.onAdd
 * events, so the two sides stay linked.
 */
const CAMPAIGN_B24_LEAD_PREFIX = '[WhatsApp Campaign]';

module.exports = {
  MESSAGE_DIRECTION,
  MESSAGE_TYPE,
  MESSAGE_STATUS,
  CONVERSATION_STATUS,
  SYNC_STATUS,
  CAMPAIGN_STATUS,
  CAMPAIGN_TYPE,
  PROVIDER,
  WEBHOOK_SOURCE,
  WEBHOOK_LOG_STATUS,
  ROUTING_STRATEGY,
  AGENT_ROLE,
  BITRIX24_METHODS,
  BITRIX24_EVENTS,
  CAMPAIGN_B24_LEAD_PREFIX,
};
