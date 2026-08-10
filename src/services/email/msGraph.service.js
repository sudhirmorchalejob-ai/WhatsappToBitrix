const axios = require('axios');
const logger = require('../../utils/logger');
const { env } = require('../../config');

const log = logger.childFor('ms-graph-email');

const TOKEN_URL = (tenantId) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const SEND_MAIL_URL = 'https://graph.microsoft.com/v1.0/users/{sender}/sendMail';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * Microsoft Graph mail delivery (client-credentials flow).
 *
 * Sends transactional email (e.g. password-reset links) from
 * MICROSOFT_SENDER_EMAIL. A cached OAuth2 bearer token is fetched once
 * per ~50 minutes, so follow-up mail is fast.
 */
class MsGraphEmailService {
  isConfigured() {
    return Boolean(
      env.MICROSOFT_TENANT_ID &&
        env.MICROSOFT_CLIENT_ID &&
        env.MICROSOFT_CLIENT_SECRET &&
        env.MICROSOFT_SENDER_EMAIL
    );
  }

  async getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiresAt) {
      return cachedToken;
    }

    if (!this.isConfigured()) {
      throw new Error('Microsoft Graph email is not configured (missing MICROSOFT_* env vars)');
    }

    const params = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await axios.post(TOKEN_URL(env.MICROSOFT_TENANT_ID), params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const token = res.data && res.data.access_token;
    if (!token) {
      throw new Error('Microsoft Graph token response missing access_token');
    }

    const expiresIn = Number(res.data.expires_in) || 3600;
    cachedToken = token;
    cachedTokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;
    return token;
  }

  async sendMail({ to, subject, html }) {
    if (!to || !subject || !html) {
      throw new Error('sendMail requires to, subject and html');
    }
    if (!this.isConfigured()) {
      throw new Error('Microsoft Graph email is not configured (missing MICROSOFT_* env vars)');
    }

    const token = await this.getAccessToken();

    const payload = {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    };

    const url = SEND_MAIL_URL.replace('{sender}', env.MICROSOFT_SENDER_EMAIL);
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    log.info('email sent via Microsoft Graph', { to, subject });
    return { accepted: true, to, subject };
  }

  /**
   * Branded password-reset email. Renders the WA logo from the dashboard
   * so recipients recognise the sender (helps keep it out of spam) and
   * includes a one-click reset button with a plain-text fallback link.
   */
  async sendPasswordResetEmail({ to, name = '', resetLink }) {
    const base = env.FRONTEND_URL || env.APP_BASE_URL || 'http://localhost:9191';
    const logoUrl = `${base}/WA_logo.png`;
    const greeting = name && name.trim() ? `Hi ${name.trim().split(' ')[0]},` : 'Hi,';

    const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#0b1020;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b1020;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:#128c7e;padding:24px 32px;text-align:center;">
                <img src="${logoUrl}" alt="WhatsApp By Averlon" width="120" height="auto" style="border-radius:12px;" />
                <div style="color:#ffffff;font-size:22px;font-weight:600;margin-top:12px;">WhatsApp By Averlon</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px;">
                <div style="font-size:16px;line-height:1.6;color:#1e293b;">
                  <p style="margin:0 0 16px;">${greeting}</p>
                  <p style="margin:0 0 24px;">We received a request to reset your password for your
                    <strong>WhatsApp By Averlon</strong> dashboard account. Click the button below to set a new password.
                    This link is valid for <strong>1 hour</strong>.</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding:8px 0 28px;">
                        <a href="${resetLink}"
                           style="display:inline-block;background-color:#128c7e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 40px;border-radius:10px;">
                          Reset Password
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 24px;font-size:13px;color:#64748b;">If the button doesn't work, copy and paste this link into your browser:</p>
                  <p style="margin:0 0 24px;font-size:13px;color:#128c7e;word-break:break-all;">${resetLink}</p>
                  <p style="margin:0;font-size:12px;color:#94a3b8;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;padding:18px 32px;text-align:center;font-size:12px;color:#94a3b8;">
                WhatsApp By Averlon &middot; Manage WhatsApp leads &amp; Bitrix24 integrations
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return this.sendMail({
      to,
      subject: 'Reset your WhatsApp By Averlon password',
      html,
    });
  }
}

module.exports = { MsGraphEmailService };
