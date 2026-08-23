const axios = require('axios');
const logger = require('../../utils/logger');
const sleep = require('../../utils/sleep');
const { WhatsBoxApiError } = require('./whatsbox.error');

const log = logger.childFor('whatsbox');

const DEFAULT_RETRIES = 3;
const MAX_BACKOFF_MS = 10000;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function isTransient(err) {
  if (!(err instanceof WhatsBoxApiError)) return false;
  if (err.statusCode === 429) return true;
  if (err.code === 'NETWORK_ERROR') return true;
  return String(err.statusCode).startsWith('5');
}

function mapAxiosError(err) {
  if (err instanceof WhatsBoxApiError) return err;

  const response = err.response;
  const data = response && response.data;
  const message =
    (data && (data.message || data.error || data.error_description)) || err.message || 'WhatsBox request failed';

  if (response) {
    return new WhatsBoxApiError(message, data && data.error ? String(data.error) : `HTTP_${response.status}`, response.status, data || null);
  }

  if (err.request) {
    return new WhatsBoxApiError(`WhatsBox unreachable: ${err.code || err.message}`, 'NETWORK_ERROR', 502);
  }

  return new WhatsBoxApiError(message, 'UNKNOWN', 502);
}

class WhatsBoxClient {
  constructor({ baseURL, apiKey }) {
    if (!baseURL) {
      throw new WhatsBoxApiError('WHATSBOX_API_URL is not configured', 'NOT_CONFIGURED', 503);
    }

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    this.http = axios.create({
      baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      headers,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => Promise.reject(mapAxiosError(err))
    );
  }

  /**
   * POST to an API path with transient-failure retry + backoff.
   * Treats `success: false` in the body as an error too.
   */
  async post(path, payload, { retries = DEFAULT_RETRIES } = {}) {
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      const startedAt = Date.now();
      try {
        const res = await this.http.post(path, payload);
        const data = res && res.data;

        if (data && (data.success === false || data.accepted === false)) {
          const errMsg = data.message || (typeof data.data === 'string' ? data.data : null) || data.error || 'WhatsApp gateway rejected request';
          throw new WhatsBoxApiError(
            errMsg,
            data.error || 'GATEWAY_REJECTED',
            res.status,
            data
          );
        }

        log.info(`[WhatsApp Gateway OK] ${path}`, {
          durationMs: Date.now() - startedAt,
          attempt: attempt + 1,
          status: res.status,
          response: typeof data === 'object' ? JSON.stringify(data).slice(0, 300) : data,
        });
        return data;
      } catch (err) {
        const normalized = err instanceof WhatsBoxApiError ? err : mapAxiosError(err);
        lastError = normalized;

        if (attempt >= retries || !isTransient(normalized)) {
          log.error(`[WhatsApp Gateway FAILED] ${path}`, {
            code: normalized.code,
            message: normalized.message,
            status: normalized.statusCode,
            attempt: attempt + 1,
            payload: JSON.stringify(payload).slice(0, 500),
          });
          throw normalized;
        }

        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        log.warn(`[WhatsApp Gateway RETRY] ${path} attempt ${attempt}/${retries}`, {
          code: normalized.code,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Downloads a media file (WhatsBox media links point to CDN/S3).
   * Rejects text/html bodies which are usually 200-OK error pages.
   */
  async download(url, { maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: maxBytes,
    });

    const contentType = String(res.headers['content-type'] || '');
    if (contentType.includes('text/html')) {
      throw new WhatsBoxApiError('Downloaded content is HTML, expected a media file', 'NOT_MEDIA', 502);
    }

    return {
      buffer: Buffer.from(res.data),
      mimeType: contentType,
      size: res.data.byteLength,
    };
  }
}

module.exports = { WhatsBoxClient, mapAxiosError, isTransient };
