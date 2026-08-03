const axios = require('axios');
const logger = require('../../utils/logger');
const sleep = require('../../utils/sleep');
const { MetaApiError } = require('./meta.error');

const log = logger.childFor('meta');

const DEFAULT_RETRIES = 3;
const MAX_BACKOFF_MS = 10000;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Meta returns a structured JSON body on failure even when the HTTP
 * status is not 2xx: { error: { message, type, code, error_subcode,
 * fbtrace_id } }.
 */
function mapAxiosError(err) {
  if (err instanceof MetaApiError) return err;

  const response = err.response;
  const data = response && response.data;

  if (data && data.error && typeof data.error === 'object') {
    const meta = data.error;
    return new MetaApiError(
      meta.message || 'Meta API request failed',
      meta.code !== undefined ? String(meta.code) : meta.type || 'META_ERROR',
      response.status || 502,
      data
    );
  }

  if (response) {
    return new MetaApiError(
      `Meta API returned HTTP ${response.status}`,
      `HTTP_${response.status}`,
      response.status,
      response.data
    );
  }

  if (err.request) {
    return new MetaApiError(`Meta API unreachable: ${err.code || err.message}`, 'NETWORK_ERROR', 502);
  }

  return new MetaApiError(err.message, 'UNKNOWN', 502);
}

/**
 * Transient failures worth a retry: HTTP 429 (rate limit), network
 * failures, 5xx, and Meta's "temporarily blocked" message code 131056.
 */
function isTransient(err) {
  if (!(err instanceof MetaApiError)) return false;
  if (err.statusCode === 429) return true;
  if (err.code === 'NETWORK_ERROR') return true;
  if (err.code === '131056') return true;
  return String(err.statusCode).startsWith('5');
}

class MetaClient {
  constructor({ baseURL = 'https://graph.facebook.com', version = 'v21.0', accessToken }) {
    if (!accessToken) {
      throw new MetaApiError('META_ACCESS_TOKEN is not configured', 'NOT_CONFIGURED', 503);
    }
    if (!version) {
      throw new MetaApiError('META_GRAPH_VERSION is not configured', 'NOT_CONFIGURED', 503);
    }

    const apiBase = String(baseURL).replace(/\/+$/, '');
    this.version = version;

    this.http = axios.create({
      baseURL: `${apiBase}/${version}`,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => Promise.reject(mapAxiosError(err))
    );
  }

  /**
   * POST to a Graph API path with transient-failure retry + backoff.
   * Relative paths are resolved against `baseURL/version`, e.g.
   * `/${phoneNumberId}/messages`.
   */
  async post(path, payload, { retries = DEFAULT_RETRIES } = {}) {
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      const startedAt = Date.now();
      try {
        const res = await this.http.post(path, payload);
        log.debug(`[ok] POST ${path}`, { durationMs: Date.now() - startedAt, attempt: attempt + 1 });
        return res.data;
      } catch (err) {
        const normalized = err instanceof MetaApiError ? err : mapAxiosError(err);
        lastError = normalized;

        if (attempt >= retries || !isTransient(normalized)) {
          log.error(`[fail] POST ${path}`, {
            code: normalized.code,
            message: normalized.message,
            status: normalized.statusCode,
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1,
          });
          throw normalized;
        }

        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        log.warn(`[retry] POST ${path} attempt ${attempt}/${retries}`, {
          code: normalized.code,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * GET a Graph API path (JSON). Same retry semantics as post().
   */
  async get(path, { retries = DEFAULT_RETRIES } = {}) {
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      const startedAt = Date.now();
      try {
        const res = await this.http.get(path);
        log.debug(`[ok] GET ${path}`, { durationMs: Date.now() - startedAt, attempt: attempt + 1 });
        return res.data;
      } catch (err) {
        const normalized = err instanceof MetaApiError ? err : mapAxiosError(err);
        lastError = normalized;

        if (attempt >= retries || !isTransient(normalized)) {
          log.error(`[fail] GET ${path}`, {
            code: normalized.code,
            message: normalized.message,
            status: normalized.statusCode,
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1,
          });
          throw normalized;
        }

        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        log.warn(`[retry] GET ${path} attempt ${attempt}/${retries}`, {
          code: normalized.code,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Downloads the bytes behind a media URL (a short-lived signed URL
   * returned by GET /{mediaId}). Rejects text/html bodies which are
   * usually 200-OK error pages.
   */
  async download(url, { maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
    const token = this.http.defaults.headers.Authorization;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: maxBytes,
      headers: { Authorization: token },
    });

    const contentType = String(res.headers['content-type'] || '');
    if (contentType.includes('text/html')) {
      throw new MetaApiError('Downloaded content is HTML, expected a media file', 'NOT_MEDIA', 502);
    }

    return {
      buffer: Buffer.from(res.data),
      mimeType: contentType,
      size: res.data.byteLength,
    };
  }
}

module.exports = { MetaClient, mapAxiosError, isTransient };
