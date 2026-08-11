const { env } = require('../../config');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { BITRIX24_METHODS, MESSAGE_PROVIDER } = require('../../constants');
const { InstallRepository } = require('../../repositories');
const { Bitrix24Service } = require('./bitrix24.service');

const log = logger.childFor('bitrix24-message-provider');

// Bitrix24 only allows a-z, A-Z, 0-9, '.', '-', '_' in the provider CODE.
const CODE_RE = /^[a-zA-Z0-9._-]{1,50}$/;

/**
 * Registers the app's SMS message provider on a Bitrix24 portal so the
 * CRM / Automation / Marketing tools can send messages through this
 * middleware. Backed by the official Message Service API:
 *
 *   - messageservice.sender.add / .update / .list / .delete
 *   - messageservice.message.status.update
 *
 * All methods only work inside the context of an installed application,
 * so every call goes through the app OAuth token (callAsApp), never an
 * incoming webhook.
 *
 * One provider is registered per portal with a code that encodes the
 * portal's member_id (`wa_b24_sms_<member_id>`). The shared handler URL
 * (/api/bitrix24/sms) parses `code` back into the member_id to resolve
 * the owning install/tenant for the incoming request.
 */
class Bitrix24MessageProviderService {
  constructor({ installRepository = new InstallRepository(), bitrix24 = null } = {}) {
    this.installRepo = installRepository;
    this.bitrix24 = bitrix24 || new Bitrix24Service();
  }

  /** Handler URL registered with Bitrix24; must be publicly reachable. */
  handlerUrl() {
    const base = String(env.APP_BASE_URL || '').replace(/\/+$/, '');
    return base ? `${base}/api/bitrix24/sms` : '';
  }

  /** Provider code for a portal — encodes the member_id for tenant lookup. */
  providerCode(memberId) {
    return `${MESSAGE_PROVIDER.CODE_PREFIX}_${String(memberId || '').trim()}`;
  }

  /** Inverse of providerCode(): extracts the member_id from an incoming `code`. */
  parseMemberIdFromCode(code) {
    const prefix = `${MESSAGE_PROVIDER.CODE_PREFIX}_`;
    const value = String(code || '').trim();
    if (!value.startsWith(prefix)) return null;
    const memberId = value.slice(prefix.length);
    return memberId || null;
  }

  _assertCode(code) {
    if (!CODE_RE.test(String(code))) {
      throw new AppError('Invalid message provider CODE', 400, null, 'MESSAGE_PROVIDER_CODE_INVALID');
    }
  }

  _name() {
    return { en: MESSAGE_PROVIDER.NAME };
  }

  /**
   * Lists the message providers registered by the app on the portal.
   * Normalizes the sender.list result (array, or { result: [...] }).
   */
  async list(memberId) {
    const result = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_LIST);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.result)) return result.result;
    return [];
  }

  /**
   * Registers (or re-registers) the SMS provider. Idempotent: when the
   * code already exists the provider is updated instead of added, so the
   * handler URL always tracks APP_BASE_URL. Registration is best-effort —
   * callers must not let a provider failure break app install.
   */
  async register(memberId) {
    const code = this.providerCode(memberId);
    this._assertCode(code);
    const handler = this.handlerUrl();
    if (!handler) {
      return { ok: false, skipped: 'no-handler-url', error: 'APP_BASE_URL not configured' };
    }

    const payload = {
      CODE: code,
      TYPE: MESSAGE_PROVIDER.TYPE,
      HANDLER: handler,
      NAME: this._name(),
    };

    try {
      const existing = await this.list(memberId);
      const found = (Array.isArray(existing) ? existing : []).some((s) => s && String(s.CODE) === code);
      if (found) {
        const result = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_UPDATE, payload);
        log.info('message provider updated', { memberId, code });
        return { ok: true, code, handler, registered: false, updated: true, result };
      }
    } catch (err) {
      log.warn('message provider list/update failed; falling back to add', {
        memberId,
        code,
        errorCode: err.code,
        message: err.message,
      });
    }

    try {
      const result = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_ADD, payload);
      log.info('message provider registered', { memberId, code, handler });
      return { ok: true, code, handler, registered: true, result };
    } catch (err) {
      log.warn('message provider registration failed', {
        memberId,
        code,
        errorCode: err.code,
        message: err.message,
      });
      return { ok: false, code, handler, error: err.message, errorCode: err.code };
    }
  }

  /** Removes the provider from the portal (best-effort, on uninstall). */
  async unregister(memberId) {
    const code = this.providerCode(memberId);
    try {
      const result = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.MESSAGE_SERVICE_SENDER_DELETE, { CODE: code });
      log.info('message provider removed', { memberId, code });
      return { ok: true, code, result };
    } catch (err) {
      log.warn('message provider delete failed', { memberId, code, errorCode: err.code, message: err.message });
      return { ok: false, code, error: err.message };
    }
  }

  /**
   * Updates the delivery status of a message previously handed to the
   * handler. STATUS is one of: queued, sent, delivered, undelivered, failed.
   */
  async updateMessageStatus(memberId, { messageId, status }) {
    const code = this.providerCode(memberId);
    const result = await this.bitrix24.callAsApp(memberId, BITRIX24_METHODS.MESSAGE_SERVICE_MESSAGE_STATUS_UPDATE, {
      CODE: code,
      MESSAGE_ID: String(messageId),
      STATUS: String(status),
    });
    return { ok: true, result };
  }

  /** Resolves the owning install row from a provider `code` in a payload. */
  async resolveInstallByCode(code) {
    const memberId = this.parseMemberIdFromCode(code);
    if (!memberId) return null;
    return this.installRepo.findByMemberId(memberId);
  }
}

module.exports = { Bitrix24MessageProviderService };
