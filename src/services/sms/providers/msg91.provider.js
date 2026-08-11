const axios = require('axios');
const { normalizePhone } = require('../../../helpers/phone');

const MSG91_DEFAULT_BASE_URL = 'https://api.msg91.com/api/sendhttp.php';

/**
 * MSG91 classic HTTP SMS API.
 *
 * sendText:   POST https://api.msg91.com/api/sendhttp.php
 *             authkey / mobiles / message / sender / route / country / DLT_TE_ID
 *             -> { "type": "success", "message": "<message id>" }
 *             -> { "type": "error",   "message": "..." }
 *
 * Delivery:   MSG91 DLR callback POSTs { msgid, status, ... } with
 *             status like DELIVRD / UNDELIV / REJECTD / FAILED.
 */
class Msg91Provider {
  name = 'msg91';

  _http() {
    return axios.create({ timeout: 30000 });
  }

  async sendText({ to, body, apiKey, senderId = null, route = null, templateId = null, baseUrl = MSG91_DEFAULT_BASE_URL }) {
    const phone = normalizePhone(to);
    if (!phone) throw new Error('Invalid recipient phone number');

    const params = {
      authkey: String(apiKey || ''),
      mobiles: phone,
      message: body,
      sender: String(senderId || ''),
      route: String(route || ''),
    };
    if (templateId) params.DLT_TE_ID = String(templateId);

    const res = await this._http().post(baseUrl, null, { params });
    const data = res.data || {};

    if (typeof data === 'object' && String(data.type || '').toLowerCase() === 'error') {
      throw new Error(`MSG91 send failed: ${data.message || res.statusText || 'unknown error'}`);
    }

    const providerMessageId =
      (typeof data === 'object' && (data.message || data.request_id || data.msgid)) || null;
    return { providerMessageId: providerMessageId ? String(providerMessageId) : null, raw: data };
  }

  async testConnection({ apiKey, senderId = null, route = null, templateId = null, baseUrl = MSG91_DEFAULT_BASE_URL }) {
    if (!apiKey) return { ok: false, error: 'SMS_API_KEY is not configured' };
    const res = await this._http().get(baseUrl, {
      params: {
        authkey: String(apiKey),
        mobiles: '9999999999',
        message: 'connection test',
        sender: String(senderId || ''),
        route: String(route || ''),
      },
    });
    const data = res.data || {};
    const ok = String(data.type || '').toLowerCase() !== 'error';
    return {
      ok,
      reachable: true,
      httpStatus: res.status,
      authVerified: ok,
      note: ok ? 'MSG91 reachable' : `MSG91 responded: ${data.message || 'error'}`,
    };
  }
}

module.exports = { Msg91Provider };
