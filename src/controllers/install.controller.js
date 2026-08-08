const { sendSuccess, sendError } = require('../utils/ApiResponse');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { InstallRepository } = require('../repositories');
const { WebhookLogRepository } = require('../repositories');
const { Bitrix24Service, Bitrix24ConnectorService } = require('../services/bitrix24');
const { WEBHOOK_SOURCE, WEBHOOK_LOG_STATUS, BITRIX24_EVENTS } = require('../constants');
const { b24InstallPage } = require('../utils/b24InstallPage');

const log = logger.childFor('install');

function mask(tokens) {
  const maskToken = (t) => (t && t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : null);
  return {
    accessToken: maskToken(tokens.accessToken),
    refreshToken: maskToken(tokens.refreshToken),
    applicationToken: maskToken(tokens.applicationToken),
  };
}

/**
 * Marketplace app install/uninstall lifecycle (Bitrix24).
 *
 * GET  /install   - app opened inside the portal; query params carry the
 *                   AUTH_ID / REFRESH_ID / member_id / DOMAIN tokens.
 * POST /install   - ONAPPINSTALL event (recommended for "API only" apps).
 * POST /uninstall - ONAPPUNINSTALL event; verified with application_token.
 */
class InstallController {
  constructor({
    installRepo = new InstallRepository(),
    webhookLogRepo = new WebhookLogRepository(),
    bitrix24Service = new Bitrix24Service(),
    connectorService = new Bitrix24ConnectorService(),
  } = {}) {
    this.installRepo = installRepo;
    this.webhookLogRepo = webhookLogRepo;
    this.bitrix24 = bitrix24Service;
    this.connector = connectorService;
  }

  async _postInstall({ auth, eventType, payload, ip }) {
    let install;
    try {
      install = await this.bitrix24.oauth.installFromEvent(auth);
    } catch (err) {
      await this.webhookLogRepo.create({
        source: WEBHOOK_SOURCE.BITRIX24,
        eventType,
        payload,
        status: WEBHOOK_LOG_STATUS.FAILED,
        errorMessage: err.message,
        ip,
      });
      throw err;
    }

    await this.webhookLogRepo.create({
      source: WEBHOOK_SOURCE.BITRIX24,
      eventType,
      payload,
      status: WEBHOOK_LOG_STATUS.PROCESSED,
      ip,
    });

    // Post-install hooks are best-effort: confirm install + bind events +
    // provision the Open Channels connector.
    this.bitrix24.activate(install.memberId);
    try {
      await this.bitrix24.confirmInstall(install.memberId);
    } catch (err) {
      log.warn('app.info confirmation failed', { memberId: install.memberId, code: err.code, message: err.message });
    }
    try {
      const bindings = await this.bitrix24.bindEvents(install.memberId);
      if (bindings.some((b) => !b.ok)) {
        log.warn('some event.bind calls failed', { memberId: install.memberId, bindings });
      }
    } catch (err) {
      log.warn('event binding failed', { memberId: install.memberId, code: err.code, message: err.message });
    }
    await this._provisionConnector(install.memberId);

    return install;
  }

  /** Registers the connector + binds open-line events (best-effort). */
  async _provisionConnector(memberId) {
    try {
      const summary = await this.connector.provision(memberId);
      if (summary.error) {
        log.warn('connector provisioning incomplete', { memberId, error: summary.error });
      }
      return summary;
    } catch (err) {
      log.warn('connector provisioning failed', { memberId, code: err.code, message: err.message });
      return null;
    }
  }

  /** GET /install - app opened inside the portal (query params). */
  async install(req, res) {
    const install = await this.bitrix24.oauth.installFromParams(req.query);

    this.bitrix24.activate(install.memberId);
    try {
      await this.bitrix24.confirmInstall(install.memberId);
    } catch (err) {
      log.warn('app.info confirmation failed', { memberId: install.memberId, code: err.code, message: err.message });
    }
    try {
      await this.bitrix24.bindEvents(install.memberId);
    } catch (err) {
      log.warn('event binding failed', { memberId: install.memberId, code: err.code, message: err.message });
    }
    await this._provisionConnector(install.memberId);

    res.status(200).send(
      b24InstallPage({
        title: 'WhatsApp + Bitrix24 integration',
        body: `Installed successfully for portal <b>${install.domain || install.memberId}</b>. You can close this window.`,
      })
    );
  }

  /** POST /install - ONAPPINSTALL event with `auth` tokens. */
  async installEvent(req, res) {
    try {
      const body = req.body || {};
      const auth = body.auth || {};
      const eventType = body.event || BITRIX24_EVENTS.APP_INSTALL;
      const install = await this._postInstall({
        auth,
        eventType,
        payload: body,
        ip: req.ip,
      });
      return sendSuccess(res, { memberId: install.memberId, domain: install.domain, status: install.status }, { status: 200 });
    } catch (err) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return sendError(res, err.message, status);
    }
  }

  /** POST /uninstall - ONAPPUNINSTALL event (verified via application_token). */
  async uninstall(req, res) {
    const body = req.body || {};
    const auth = body.auth || {};
    const memberId = auth.member_id;
    const eventType = body.event || BITRIX24_EVENTS.APP_UNINSTALL;

    try {
      if (!memberId) {
        throw new AppError('Uninstall event is missing member_id', 400, null, 'B24_UNINSTALL_INVALID');
      }

      const install = await this.installRepo.findByMemberId(memberId);
      if (!install) {
        // Idempotent: nothing to clean up locally.
        await this.webhookLogRepo.create({
          source: WEBHOOK_SOURCE.BITRIX24,
          eventType,
          payload: body,
          status: WEBHOOK_LOG_STATUS.PROCESSED,
          ip: req.ip,
        });
        return sendSuccess(res, { memberId, uninstalled: true, alreadyGone: true }, { status: 200 });
      }

      const verified = this.bitrix24.oauth.verifyApplicationToken(install, auth.application_token);
      if (!verified) {
        await this.webhookLogRepo.create({
          source: WEBHOOK_SOURCE.BITRIX24,
          eventType,
          payload: body,
          status: WEBHOOK_LOG_STATUS.FAILED,
          errorMessage: 'application_token mismatch',
          ip: req.ip,
        });
        return sendError(res, 'Uninstall verification failed', 403);
      }

      await this.installRepo.markUninstalled(memberId);
      await this.webhookLogRepo.create({
        source: WEBHOOK_SOURCE.BITRIX24,
        eventType,
        payload: body,
        status: WEBHOOK_LOG_STATUS.PROCESSED,
        ip: req.ip,
      });

      if (this.bitrix24.oauthCtx && this.bitrix24.oauthCtx.memberId === memberId) {
        this.bitrix24.oauthCtx = null;
        this.bitrix24.client = null;
      }

      return sendSuccess(res, { memberId, uninstalled: true }, { status: 200 });
    } catch (err) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return sendError(res, err.message, status);
    }
  }

  /** GET /app/settings - install status for the portal (tokens masked). */
  async settings(req, res) {
    const memberId = req.query.member_id || req.query.memberId;
    const list = memberId
      ? [await this.installRepo.findByMemberId(memberId)].filter(Boolean)
      : await this.installRepo.list({ limit: 50 });

    const data = list.map((i) => ({
      memberId: i.memberId,
      domain: i.domain,
      status: i.status,
      userId: i.userId,
      scope: i.scope,
      expiresAt: i.expiresAt,
      lastSeenAt: i.lastSeenAt,
      tokens: mask(i),
    }));
    return sendSuccess(res, data);
  }
}

module.exports = { InstallController };
