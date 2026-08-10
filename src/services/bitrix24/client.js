const axios = require('axios');
const { env } = require('../../config');
const { BITRIX24_METHODS } = require('../../constants');
const logger = require('../../utils/logger');
const sleep = require('../../utils/sleep');
const { Bitrix24ApiError } = require('./bitrix24.error');

const log = logger.childFor('bitrix24');

const DEFAULT_RETRIES = 3;
const MAX_BACKOFF_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;

function isTransient(err) {
  if (!(err instanceof Bitrix24ApiError)) return false;

  if (err.code === 'QUERY_LIMIT_EXCEEDED' || err.code === 'SLOW_DOWN') return true;

  const msg = `${err.message} ${err.code}`.toLowerCase();
  return (
    msg.includes('slow down') ||
    msg.includes('system is now unavailable') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    err.code.startsWith('HTTP_5')
  );
}

/**
 * Maps any axios failure into a Bitrix24ApiError:
 * - HTTP 200 + { error, error_description } handled in call()
 * - HTTP non-2xx, network errors, and timeouts handled here.
 */
function mapAxiosError(err) {
  if (err instanceof Bitrix24ApiError) return err;

  const response = err.response;
  const data = response && response.data;

  if (data && typeof data === 'object' && data.error) {
    return new Bitrix24ApiError(
      data.error_description || data.error,
      data.error,
      502,
      data
    );
  }

  if (response) {
    return new Bitrix24ApiError(
      `Bitrix24 returned HTTP ${response.status}`,
      `HTTP_${response.status}`,
      502,
      response.data
    );
  }

  if (err.request) {
    return new Bitrix24ApiError(`Bitrix24 unreachable: ${err.code || err.message}`, 'NETWORK_ERROR', 502);
  }

  return new Bitrix24ApiError(err.message, 'UNKNOWN', 502);
}

const AUTH_ERROR_CODES = new Set(['expired_token', 'invalid_token', 'WRONG_AUTH', 'INVALID_TOKEN']);

function isAuthError(err) {
  if (!(err instanceof Bitrix24ApiError)) return false;
  if (AUTH_ERROR_CODES.has(err.code)) return true;
  const msg = `${err.code} ${err.message}`.toLowerCase();
  return msg.includes('expired_token') || msg.includes('invalid_token') || msg.includes('wrong auth');
}

class Bitrix24Client {
  constructor(baseURL, options = {}) {
    if (!baseURL) {
      throw new Bitrix24ApiError(
        'BITRIX24_WEBHOOK_URL is not configured. Set it in .env (inbound webhook URL).',
        'NOT_CONFIGURED',
        503
      );
    }

    let normalizedUrl = String(baseURL).trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    if (!normalizedUrl.endsWith('/')) {
      normalizedUrl = `${normalizedUrl}/`;
    }

    this.accessToken = options.accessToken || null;
    this.onAuthFailure = options.onAuthFailure || null;
    this.http = axios.create({
      baseURL: normalizedUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => Promise.reject(mapAxiosError(err))
    );
  }

  setAccessToken(token) {
    this.accessToken = token || null;
  }

  setOnAuthFailure(fn) {
    this.onAuthFailure = fn || null;
  }

  _withAuth(params) {
    if (!this.accessToken) return params;
    return { ...params, auth: this.accessToken };
  }

  /**
   * POST {baseURL}/{method}.json with params.
   * Detects Bitrix24's HTTP-200-with-error-body convention and retries
   * transient errors with exponential backoff. When an access token is
   * configured and the API reports an auth error, `onAuthFailure` is
   * called once to rotate the token, then the call is retried.
   */
  async call(method, params = {}, { retries = DEFAULT_RETRIES } = {}) {
    let attempt = 0;
    let lastError;
    let authRetried = false;

    while (attempt <= retries) {
      const startedAt = Date.now();
      try {
        const res = await this.http.post(`${method}.json`, this._withAuth(params));

        const data = res && res.data;
        if (data && data.error) {
          throw new Bitrix24ApiError(
            data.error_description || data.error,
            data.error,
            502,
            data
          );
        }

        log.debug(`[ok] ${method}`, {
          durationMs: Date.now() - startedAt,
          attempt: attempt + 1,
        });
        return data;
      } catch (err) {
        const normalized = err instanceof Bitrix24ApiError ? err : mapAxiosError(err);

        if (
          !authRetried &&
          this.accessToken &&
          this.onAuthFailure &&
          isAuthError(normalized)
        ) {
          authRetried = true;
          try {
            const token = await this.onAuthFailure(normalized);
            this.setAccessToken(token);
            continue;
          } catch (refreshErr) {
            log.error(`[auth-refresh-failed] ${method}`, {
              code: refreshErr.code,
              message: refreshErr.message,
            });
            throw refreshErr instanceof Bitrix24ApiError ? refreshErr : normalized;
          }
        }

        lastError = normalized;

        if (attempt >= retries || !isTransient(normalized)) {
          const isAlreadyBound =
            /already binded/i.test(normalized.message || '') ||
            /already bound/i.test(normalized.message || '');

          if (isAlreadyBound) {
            log.info(`[already-bound] ${method}`, {
              code: normalized.code,
              message: normalized.message,
            });
          } else {
            log.error(`[fail] ${method}`, {
              code: normalized.code,
              message: normalized.message,
              durationMs: Date.now() - startedAt,
              attempt: attempt + 1,
            });
          }
          throw normalized;
        }

        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        log.warn(`[retry] ${method} attempt ${attempt}/${retries}`, {
          code: normalized.code,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Runs up to 50 commands in one request. Commands are full method
   * invocations: ["crm.contact.get?id=1", "crm.contact.add?fields[...]=..."].
   * Returns the ordered array of individual results.
   */
  async batch(commands, options = {}) {
    const res = await this.call(BITRIX24_METHODS.BATCH, { cmd: commands }, options);
    return (res && res.result && res.result.result) || [];
  }
}

module.exports = { Bitrix24Client, mapAxiosError, isTransient, isAuthError };

