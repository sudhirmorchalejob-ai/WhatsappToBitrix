const { sendSuccess, sendError } = require('../utils/ApiResponse');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { InstallRepository } = require('../repositories');
const { WebhookLogRepository } = require('../repositories');
const {
  Bitrix24Service,
  Bitrix24ConnectorService,
  Bitrix24MessageProviderService,
} = require('../services/bitrix24');
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
    messageProvider = new Bitrix24MessageProviderService(),
  } = {}) {
    this.installRepo = installRepo;
    this.webhookLogRepo = webhookLogRepo;
    this.bitrix24 = bitrix24Service;
    this.connector = connectorService;
    this.messageProvider = messageProvider;
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
    await this._provisionMessageProvider(install.memberId);

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

  /**
   * Registers the Message Service SMS provider (best-effort). A failure
   * here must never break the app install — Bitrix24 only grants scopes at
   * install time, so this runs on every (re-)install.
   */
  async _provisionMessageProvider(memberId) {
    try {
      const summary = await this.messageProvider.register(memberId);
      if (!summary.ok) {
        log.warn('message provider registration incomplete', {
          memberId,
          code: summary.code,
          error: summary.error,
          errorCode: summary.errorCode,
        });
      }
      return summary;
    } catch (err) {
      log.warn('message provider registration failed', { memberId, code: err.code, message: err.message });
      return null;
    }
  }

  /** Handles GET or POST /install (both in-iframe popup and background ONAPPINSTALL event) */
  async handleInstall(req, res) {
    try {
      const rawBody = req.body || {};
      let authObj = {};

      if (rawBody.auth) {
        if (typeof rawBody.auth === 'string') {
          try {
            authObj = JSON.parse(rawBody.auth);
          } catch {
            authObj = {};
          }
        } else if (typeof rawBody.auth === 'object') {
          authObj = rawBody.auth;
        }
      }

      const merged = {
        ...req.query,
        ...rawBody,
        ...authObj,
      };

      const memberId =
        merged.member_id ||
        merged.MEMBER_ID ||
        merged.memberId ||
        authObj.member_id ||
        authObj.memberId;
      const accessToken =
        merged.AUTH_ID ||
        merged.auth_id ||
        merged.access_token ||
        merged.accessToken ||
        authObj.access_token ||
        authObj.accessToken;
      const refreshToken =
        merged.REFRESH_ID ||
        merged.refresh_id ||
        merged.refresh_token ||
        merged.refreshToken ||
        authObj.refresh_token ||
        authObj.refreshToken ||
        '';
      const domain =
        merged.DOMAIN ||
        merged.domain ||
        authObj.domain ||
        '';
      const applicationToken =
        merged.application_token ||
        merged.applicationToken ||
        authObj.application_token ||
        authObj.applicationToken ||
        null;
      const clientEndpoint =
        merged.client_endpoint ||
        merged.clientEndpoint ||
        authObj.client_endpoint ||
        authObj.clientEndpoint ||
        (domain ? `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/rest/` : null);
      const scope =
        merged.scope ||
        authObj.scope ||
        null;
      const expiresIn = Number(
        merged.AUTH_EXPIRES ||
        merged.auth_expires ||
        merged.expires_in ||
        merged.expiresIn ||
        authObj.expires_in ||
        authObj.expiresIn ||
        3600
      );

      if (!memberId || !accessToken) {
        if (req.is('json') && !req.headers.accept?.includes('text/html')) {
          throw new AppError('Install event is missing member_id/access_token', 400, null, 'B24_INSTALL_INVALID');
        }
        return res.status(200).send(
          b24InstallPage({
            title: 'WhatsApp + Bitrix24 Integration',
            body: 'Installation parameters missing. Please open the application from your Bitrix24 portal.',
            ok: false,
          })
        );
      }

      const install = await this.installRepo.upsert({
        memberId,
        domain: domain || '',
        clientEndpoint,
        accessToken,
        refreshToken,
        applicationToken,
        scope,
        status: 'INSTALLED',
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        lastSeenAt: new Date(),
      });

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
      await this._provisionMessageProvider(install.memberId);

      // Return HTML page with BX24.installFinish() for iframe loads
      return res.status(200).send(
        b24InstallPage({
          title: 'WhatsApp + Bitrix24 integration',
          body: `Installed successfully for portal <b>${install.domain || install.memberId}</b>. You can close this window.`,
          ok: true,
        })
      );
    } catch (err) {
      log.error('Install handler error', { error: err.message });
      return res.status(200).send(
        b24InstallPage({
          title: 'WhatsApp + Bitrix24 integration',
          body: `Installation completed with note: ${err.message}`,
          ok: true,
        })
      );
    }
  }

  /** GET /install - backwards compatibility alias */
  async install(req, res) {
    return this.handleInstall(req, res);
  }

  /** POST /install - backwards compatibility alias */
  async installEvent(req, res) {
    return this.handleInstall(req, res);
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

      if (this.messageProvider) {
        await this.messageProvider.unregister(memberId).catch(() => {});
      }

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
