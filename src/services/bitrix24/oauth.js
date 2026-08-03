const axios = require('axios');
const crypto = require('crypto');
const { env } = require('../../config');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { InstallRepository } = require('../../repositories');
const { Bitrix24ApiError } = require('./bitrix24.error');

const log = logger.childFor('bitrix24-oauth');

const TOKEN_TIMEOUT_MS = 15000;

function safeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function pickKey(obj, keys) {
  for (const key of keys) {
    const v = obj && obj[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Bitrix24 Marketplace app OAuth.
 *
 * Install data reaches the middleware in one of two forms:
 *  1. POST /install (ONAPPINSTALL event): `auth` carries access_token,
 *     refresh_token, domain, member_id and application_token.
 *  2. GET /install (app opened inside the portal): params carry
 *     AUTH_ID (usable access token), REFRESH_ID, DOMAIN and member_id.
 *
 * The access token is valid for ~1 hour; refresh_token for 180 days and
 * must be rotated at oauth.bitrix.info before it expires.
 */
class Bitrix24OAuth {
  constructor({ installRepository = new InstallRepository(), http = axios } = {}) {
    this.installRepo = installRepository;
    this.http = http;
  }

  restBaseUrl(domain) {
    return `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/rest/`;
  }

  _credentials() {
    const clientId = env.BITRIX24_CLIENT_ID;
    const clientSecret = env.BITRIX24_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new AppError(
        'BITRIX24_CLIENT_ID / BITRIX24_CLIENT_SECRET are not configured',
        503,
        null,
        'B24_OAUTH_NOT_CONFIGURED'
      );
    }
    return { clientId, clientSecret };
  }

  /**
   * POSTs a grant request to the Bitrix24 authorization server.
   * Throws Bitrix24ApiError on failure (invalid_grant / invalid_client
   * keep their original code so callers can decide the outcome).
   */
  async _postToken(params) {
    const body = new URLSearchParams(params);
    try {
      const res = await this.http.post(env.BITRIX24_OAUTH_TOKEN_URL, body, {
        timeout: TOKEN_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = res && res.data;
      if (data && data.error) {
        throw new Bitrix24ApiError(
          data.error_description || data.error,
          data.error,
          502,
          data
        );
      }
      return data || {};
    } catch (err) {
      if (err instanceof Bitrix24ApiError) throw err;
      const response = err.response && err.response.data;
      if (response && response.error) {
        throw new Bitrix24ApiError(
          response.error_description || response.error,
          response.error,
          502,
          response
        );
      }
      throw new Bitrix24ApiError(
        `Bitrix24 OAuth server unreachable: ${err.code || err.message}`,
        'OAUTH_NETWORK_ERROR',
        502
      );
    }
  }

  /**
   * Persists an install from an ONAPPINSTALL event `auth` payload.
   * B24's portal status (L/F/P/T) is informational and is NOT stored in
   * our lifecycle `status` column (INSTALLED/UNINSTALLED/DISABLED).
   */
  async installFromEvent(auth = {}) {
    const memberId = pickKey(auth, ['member_id', 'memberId']);
    const accessToken = pickKey(auth, ['access_token', 'accessToken']);
    const refreshToken = pickKey(auth, ['refresh_token', 'refreshToken']);
    const domain = pickKey(auth, ['domain']);
    const applicationToken = pickKey(auth, ['application_token', 'applicationToken']);
    const clientEndpoint = pickKey(auth, ['client_endpoint', 'clientEndpoint']);
    const scope = pickKey(auth, ['scope']);
    const expiresIn = Number(pickKey(auth, ['expires_in', 'expiresIn']) || 3600);

    if (!memberId || !accessToken || !refreshToken) {
      throw new AppError('Install event is missing member_id/access_token/refresh_token', 400, null, 'B24_INSTALL_INVALID');
    }

    return this.installRepo.upsert({
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
  }

  /**
   * Persists an install from the GET /install params passed when the app
   * is opened inside the Bitrix24 interface (uppercase keys per the B24
   * docs, plus lowercase aliases).
   */
  async installFromParams(params = {}) {
    const memberId = pickKey(params, ['member_id', 'MEMBER_ID', 'memberId']);
    const accessToken = pickKey(params, ['AUTH_ID', 'auth_id', 'access_token', 'accessToken']);
    const refreshToken = pickKey(params, ['REFRESH_ID', 'refresh_id', 'refresh_token', 'refreshToken']);
    const domain = pickKey(params, ['DOMAIN', 'domain']);
    const expiresIn = Number(pickKey(params, ['AUTH_EXPIRES', 'auth_expires', 'expires_in']) || 3600);

    if (!memberId || !accessToken) {
      throw new AppError('Install params are missing member_id / AUTH_ID', 400, null, 'B24_INSTALL_INVALID');
    }

    return this.installRepo.upsert({
      memberId,
      domain: domain || '',
      clientEndpoint: domain ? this.restBaseUrl(domain) : null,
      accessToken,
      refreshToken: refreshToken || '',
      applicationToken: pickKey(params, ['application_token', 'applicationToken']) || null,
      scope: pickKey(params, ['scope']) || null,
      status: 'INSTALLED',
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      lastSeenAt: new Date(),
    });
  }

  /**
   * OAuth authorization_code exchange (protocol where the app only
   * receives a `code`). Stores the resulting token pair.
   */
  async exchangeCode({ code, domain, redirectUri = null }) {
    const { clientId, clientSecret } = this._credentials();
    if (!code || !domain) {
      throw new AppError('code and domain are required to exchange the authorization code', 400, null, 'B24_EXCHANGE_INVALID');
    }
    const data = await this._postToken({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri || undefined,
    });

    const memberId = pickKey(data, ['member_id', 'memberId']);
    const accessToken = pickKey(data, ['access_token', 'accessToken']);
    const refreshToken = pickKey(data, ['refresh_token', 'refreshToken']);
    if (!memberId || !accessToken || !refreshToken) {
      throw new Bitrix24ApiError('OAuth exchange returned an incomplete token payload', 'OAUTH_EXCHANGE_INVALID', 502, data);
    }

    const resolvedDomain = pickKey(data, ['domain']) || domain;
    return this.installRepo.upsert({
      memberId,
      domain: resolvedDomain,
      clientEndpoint: pickKey(data, ['client_endpoint', 'clientEndpoint']) || this.restBaseUrl(resolvedDomain),
      accessToken,
      refreshToken,
      applicationToken: null,
      userId: Number(pickKey(data, ['user_id', 'userId'])) || null,
      scope: pickKey(data, ['scope']) || null,
      status: 'INSTALLED',
      expiresAt: new Date(Date.now() + (Number(pickKey(data, ['expires_in', 'expiresIn'])) || 3600) * 1000),
      lastSeenAt: new Date(),
    });
  }

  /**
   * Rotates the token pair for a portal using its stored refresh_token.
   * Returns the updated install row.
   */
  async refreshTokens(memberId) {
    const { clientId, clientSecret } = this._credentials();
    const install = await this.installRepo.findByMemberId(memberId);
    if (!install) {
      throw new AppError('Install not found for memberId', 404, null, 'B24_NOT_INSTALLED');
    }
    if (!install.refreshToken) {
      throw new Bitrix24ApiError('Install has no refresh token to rotate', 'OAUTH_NO_REFRESH_TOKEN', 502);
    }

    let data;
    try {
      data = await this._postToken({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: install.refreshToken,
      });
    } catch (err) {
      if (err.code === 'invalid_grant') {
        await this.installRepo.markDisabled(memberId).catch(() => {});
        log.warn('refresh token rejected; install disabled', { memberId, code: err.code });
      }
      throw err;
    }

    const accessToken = pickKey(data, ['access_token', 'accessToken']);
    const refreshToken = pickKey(data, ['refresh_token', 'refreshToken']);
    if (!accessToken) {
      throw new Bitrix24ApiError('OAuth refresh returned no access_token', 'OAUTH_REFRESH_INVALID', 502, data);
    }

    return this.installRepo.updateTokens(memberId, {
      accessToken,
      refreshToken: refreshToken || install.refreshToken,
      expiresAt: new Date(Date.now() + (Number(pickKey(data, ['expires_in', 'expiresIn'])) || 3600) * 1000),
      domain: pickKey(data, ['domain']) || install.domain,
      clientEndpoint: pickKey(data, ['client_endpoint', 'clientEndpoint']) || install.clientEndpoint,
      scope: pickKey(data, ['scope']) || install.scope,
    });
  }

  /** Marks an install uninstalled (tokens are revoked by B24 anyway). */
  async revoke(memberId) {
    return this.installRepo.markUninstalled(memberId);
  }

  /**
   * Constant-time check of the ON_APP_UNINSTALL event's application_token
   * against the stored one. After uninstall this token is the only
   * credential B24 still trusts, so the check must be strict.
   */
  verifyApplicationToken(install, token) {
    if (!install || !install.applicationToken || !token) return false;
    return safeEqualStr(token, install.applicationToken);
  }
}

module.exports = { Bitrix24OAuth };
