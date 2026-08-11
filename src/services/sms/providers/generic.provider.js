const axios = require('axios');
const { normalizePhone } = require('../../../helpers/phone');

/**
 * Generic JSON SMS gateway. Expects an endpoint that accepts a POST with
 * the recipient + text and returns a JSON body containing a message id
 * under one of the common keys (id / data.id / message_id / request_id).
 *
 * The auth scheme is chosen from the config: `SMS_AUTH` is either
 * "bearer" (Authorization: Bearer <key>), "x-api-key" (x-api-key: <key>)
 * or "none".
 */
class GenericProvider {
  name = 'generic';

  _http({ baseUrl, apiKey, auth }) {
    const headers = {};
    if (apiKey && auth === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
    else if (apiKey && auth === 'x-api-key') headers['x-api-key'] = apiKey;
    return axios.create({ baseURL: baseUrl, headers, timeout: 30000 });
  }

  _extractId(data) {
    if (!data || typeof data !== 'object') return null;
    const candidates = [
      data.id,
      data.data && data.data.id,
      data.message_id,
      data.messageId,
      data.request_id,
      data.requestId,
      data.result && data.result.id,
    ];
    const found = candidates.find((c) => typeof c === 'string' || typeof c === 'number');
    return found != null ? String(found) : null;
  }

  async sendText({ to, body, apiKey, senderId = null, route = null, templateId = null, baseUrl }) {
    if (!baseUrl) throw new Error('SMS_API_URL is not configured');
    const phone = normalizePhone(to);
    if (!phone) throw new Error('Invalid recipient phone number');

    const payload = {
      to: phone,
      phone,
      recipient: phone,
      mobiles: phone,
      text: body,
      message: body,
      body,
    };
    if (senderId) payload.sender = String(senderId);
    if (route) payload.route = String(route);
    if (templateId) payload.template_id = String(templateId);

    const client = this._http({ baseUrl, apiKey, auth: 'bearer' });
    const res = await client.post('', payload);
    const data = res.data || {};

    const providerMessageId = this._extractId(data);
    return { providerMessageId, raw: data };
  }

  async testConnection({ apiKey, baseUrl }) {
    if (!baseUrl) return { ok: false, error: 'SMS_API_URL is not configured' };
    try {
      const client = this._http({ baseUrl, apiKey, auth: 'bearer' });
      const res = await client.get('');
      return {
        ok: res.status >= 200 && res.status < 500,
        reachable: true,
        httpStatus: res.status,
        authVerified: res.status < 400,
        note: res.status < 400 ? 'Generic gateway reachable' : `Gateway responded with HTTP ${res.status}`,
      };
    } catch (err) {
      const status = err.response && err.response.status;
      if (status) {
        return {
          ok: status < 500,
          reachable: true,
          httpStatus: status,
          authVerified: status < 400,
          note: `Gateway responded with HTTP ${status}`,
        };
      }
      return { ok: false, reachable: false, error: err.code || err.message || 'connection failed' };
    }
  }
}

module.exports = { GenericProvider };
