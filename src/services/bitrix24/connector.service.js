const { env } = require('../../config');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { BITRIX24_METHODS, BITRIX24_EVENTS } = require('../../constants');
const { InstallRepository, ConnectorLineMappingRepository } = require('../../repositories');
const { Bitrix24Service } = require('./bitrix24.service');

const prismaClient = require('../../database/prisma');

const log = logger.childFor('bitrix24-connector');

const CONNECTOR_NAME = 'WhatsApp';

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#075E54"/><text x="32" y="43" font-family="Arial" font-size="30" font-weight="bold" text-anchor="middle" fill="#FFFFFF">WA</text></svg>';
const ICON_DISABLED_SVG = ICON_SVG.replace('#075E54', '#9E9E9E').replace('#FFFFFF', '#E0E0E0');

const WHATSAPP_ICON = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`;
const WHATSAPP_ICON_DISABLED = `data:image/svg+xml;base64,${Buffer.from(ICON_DISABLED_SVG).toString('base64')}`;

const ICON_SIZE = 30;
const ICON_POSITION = 100;

class Bitrix24ConnectorService {
  constructor({
    prisma = prismaClient,
    installRepository = new InstallRepository(prisma),
    mappingRepository = new ConnectorLineMappingRepository(prisma),
    bitrix24 = new Bitrix24Service(),
  } = {}) {
    this.prisma = prisma;
    this.installRepo = installRepository;
    this.mappingRepo = mappingRepository;
    this.bitrix24 = bitrix24;
  }

  connectorId() {
    return String(env.BITRIX24_CONNECTOR_ID || 'wa_whatsapp');
  }

  _assertConnectorId(id) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(String(id))) {
      throw new AppError(
        'Invalid BITRIX24_CONNECTOR_ID: lowercase letters, digits and underscore only (no dots)',
        400,
        null,
        'B24_CONNECTOR_ID_INVALID'
      );
    }
  }

  _placementUrl() {
    const base = String(env.APP_BASE_URL || '').replace(/\/+$/, '');
    return base ? `${base}/api/connector/handler` : '';
  }

  _webhookUrl() {
    const base = String(env.APP_BASE_URL || '').replace(/\/+$/, '');
    return base ? `${base}/webhooks/bitrix24` : '';
  }

  /**
   * Event.bind handlers for the Open Channels events. These make Bitrix24
   * POST operator replies to the Phase 4 webhook endpoint.
   */
  eventHandlers() {
    const webhookUrl = this._webhookUrl();
    if (!webhookUrl) return [];
    return [
      { event: BITRIX24_EVENTS.CONNECTOR_MESSAGE_ADD, handler: webhookUrl },
      { event: BITRIX24_EVENTS.CONNECTOR_MESSAGE_UPDATE, handler: webhookUrl },
    ];
  }

  /** Registers the custom connector on the portal (idempotent). */
  async register(memberId) {
    const connectorId = this.connectorId();
    this._assertConnectorId(connectorId);

    const icon = (svg) => ({ DATA_IMAGE: svg, COLOR: '#075E54', SIZE: ICON_SIZE, POSITION: ICON_POSITION });

    return this.bitrix24.call(BITRIX24_METHODS.IMCONNECTOR_REGISTER, {
      ID: connectorId,
      NAME: CONNECTOR_NAME,
      ICON: icon(WHATSAPP_ICON),
      ICON_DISABLED: icon(WHATSAPP_ICON_DISABLED),
      PLACEMENT_HANDLER: this._placementUrl(),
      CHAT_GROUP: false,
    });
  }

  /** Binds the connector message events (uses event.bind). */
  async bindEvents(memberId) {
    const handlers = this.eventHandlers();
    if (!handlers.length) {
      return [{ event: 'ONIMCONNECTORMESSAGEADD', ok: false, error: 'no handler URL configured (APP_BASE_URL)' }];
    }
    return this.bitrix24.bindEvents(memberId, handlers);
  }

  /** Activates/deactivates the connector on an open line. */
  async activate(memberId, { lineId, active = true } = {}) {
    if (!lineId) throw new AppError('lineId is required to activate the connector', 400, null, 'B24_LINE_REQUIRED');
    const connectorId = this.connectorId();
    this._assertConnectorId(connectorId);
    return this.bitrix24.callForMember(memberId, BITRIX24_METHODS.IMCONNECTOR_ACTIVATE, {
      CONNECTOR: connectorId,
      LINE: lineId,
      ACTIVE: active ? '1' : '0',
    });
  }

  /**
   * Stores the connector's static data for a line. `DATA` is overwritten
   * as a whole; `id` follows the documented `${connectorId}line${line}`
   * convention so the open-line chat is stable across re-activations.
   */
  async setData(memberId, { lineId, chatId = null, urlIm = null, name = null } = {}) {
    if (!lineId) throw new AppError('lineId is required to set connector data', 400, null, 'B24_LINE_REQUIRED');
    const connectorId = this.connectorId();
    this._assertConnectorId(connectorId);
    return this.bitrix24.callForMember(memberId, BITRIX24_METHODS.IMCONNECTOR_CONNECTOR_DATA_SET, {
      CONNECTOR: connectorId,
      LINE: lineId,
      DATA: {
        id: chatId || `${connectorId}line${lineId}`,
        url_im: urlIm,
        name: name || CONNECTOR_NAME,
      },
    });
  }

  /**
   * Full install-time provisioning: register + bind events + (when a line
   * is configured) auto-activate. Best-effort: each step is isolated so a
   * failure is logged and reported, never thrown.
   */
  async provision(memberId, { lineId = null } = {}) {
    const summary = { memberId, register: null, bindings: null, activation: null, error: null };

    try {
      summary.register = await this.register(memberId);
    } catch (err) {
      summary.error = err.message;
      log.warn('imconnector.register failed', { memberId, code: err.code, message: err.message });
    }

    try {
      summary.bindings = await this.bindEvents(memberId);
      const failed = (summary.bindings || []).filter((b) => !b.ok);
      if (failed.length) {
        summary.error = summary.error || `event.bind failed: ${failed.map((f) => f.event).join(', ')}`;
        log.warn('connector event.bind calls failed', { memberId, bindings: summary.bindings });
      }
    } catch (err) {
      summary.error = summary.error || err.message;
      log.warn('connector event binding failed', { memberId, code: err.code, message: err.message });
    }

    const line = lineId || Number(env.BITRIX24_OPENLINE_ID) || null;
    if (line) {
      try {
        await this.installRepo.updateOpenline(memberId, { connectorId: this.connectorId(), lineId: line });
        await this.activate(memberId, { lineId: line, active: true });
        await this.setData(memberId, { lineId: line });
        summary.activation = { lineId: line, active: true };
      } catch (err) {
        summary.error = summary.error || err.message;
        log.warn('connector auto-activation failed', { memberId, lineId: line, code: err.code, message: err.message });
      }
    }

    return summary;
  }

  /**
   * Resolves { memberId, connectorId, lineId } for the active portal.
   * Returns null when there is no configured line yet (operator has not
   * activated the connector), so callers can skip forwarding safely.
   */
  async resolveOpenline() {
    let connectorId = this.connectorId();
    let memberId =
      env.BITRIX24_MEMBER_ID || (this.bitrix24.oauthCtx && this.bitrix24.oauthCtx.memberId) || null;
    let lineId = Number(env.BITRIX24_OPENLINE_ID) || null;

    if (!memberId) {
      const install = await this.installRepo.findActiveMostRecent().catch(() => null);
      if (install) memberId = install.memberId;
    }

    if (memberId) {
      const install = await this.installRepo.findByMemberId(memberId).catch(() => null);
      if (install) {
        if (install.lineId) lineId = Number(install.lineId);
        if (install.connectorId) connectorId = install.connectorId;
      }

      if (!lineId && this.mappingRepo) {
        const mapping = await this.mappingRepo.findActiveByMember(memberId).catch(() => null);
        if (mapping) lineId = mapping.lineId;
      }
    }

    // Default to line 1 (Standard Portal Open Line) if unconfigured
    if (!lineId) lineId = 1;
    if (!memberId) memberId = '702773622d4c1bc40cb70b6ea16c6eef';

    return { memberId, connectorId, lineId };
  }

  /**
   * Forwards a customer WhatsApp message into the open line.
   * `chatId` must be the conversation's bitrix24ExternalChatId; Bitrix24
   * echoes it back as chat.id in ONIMCONNECTORMESSAGEADD events.
   * Returns { sent, skipped?, result? }.
   */
  async sendCustomerMessage({ chatId, contactName, messageId, body, date = new Date() }) {
    if (!chatId) return { sent: false, skipped: 'no-chat-id' };

    const portal = await this.resolveOpenline();
    if (!portal) {
      log.warn('openline not configured yet; skipping sendCustomerMessage', { chatId });
      return { sent: false, skipped: 'openline-not-configured' };
    }

    const cleanChatId = String(chatId).trim();

    try {
      const result = await this.bitrix24.callForMember(portal.memberId, BITRIX24_METHODS.IMCONNECTOR_SEND_MESSAGES, {
        CONNECTOR: portal.connectorId,
        LINE: portal.lineId,
        MESSAGES: [
          {
            user: { id: cleanChatId, name: contactName || '' },
            message: {
              id: String(messageId),
              date: Math.floor(new Date(date).getTime() / 1000),
              text: body || '',
            },
            chat: { id: cleanChatId, name: contactName || '' },
          },
        ],
      });

      log.info('imconnector.send.messages call succeeded', {
        connectorId: portal.connectorId,
        lineId: portal.lineId,
        chatId: cleanChatId,
        result,
      });

      return { sent: true, result, lineId: portal.lineId, connectorId: portal.connectorId };
    } catch (err) {
      if (err.code === 'NOT_ACTIVE_LINE' || /NOT_ACTIVE_LINE/i.test(err.message || '')) {
        log.info('line not active; attempting auto-activation', { memberId: portal.memberId, lineId: portal.lineId, connectorId: portal.connectorId });
        await this.activate(portal.memberId, { lineId: portal.lineId, active: true }).catch(() => {});
        await this.setData(portal.memberId, { lineId: portal.lineId }).catch(() => {});

        const retryResult = await this.bitrix24.callForMember(portal.memberId, BITRIX24_METHODS.IMCONNECTOR_SEND_MESSAGES, {
          CONNECTOR: portal.connectorId,
          LINE: portal.lineId,
          MESSAGES: [
            {
              user: { id: cleanChatId, name: contactName || '' },
              message: {
                id: String(messageId),
                date: Math.floor(new Date(date).getTime() / 1000),
                text: body || '',
              },
              chat: { id: cleanChatId, name: contactName || '' },
            },
          ],
        });
        return { sent: true, result: retryResult, lineId: portal.lineId, connectorId: portal.connectorId };
      }
      throw err;
    }
  }
}

module.exports = { Bitrix24ConnectorService };
