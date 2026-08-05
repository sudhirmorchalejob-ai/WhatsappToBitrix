const { env } = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { InstallRepository, ConnectorLineMappingRepository, ActivityLogRepository } = require('../repositories');
const { Bitrix24Service, Bitrix24ConnectorService } = require('../services/bitrix24');

const log = logger.childFor('connector-module-controller');

function parsePlacementOptions(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    log.warn('invalid PLACEMENT_OPTIONS payload', { raw: String(raw).slice(0, 200) });
    return {};
  }
}

class ConnectorModuleController {
  constructor({
    installRepo = new InstallRepository(),
    mappingRepo = new ConnectorLineMappingRepository(),
    activityLogRepo = new ActivityLogRepository(),
    bitrix24 = new Bitrix24Service(),
    connector = new Bitrix24ConnectorService(),
  } = {}) {
    this.installRepo = installRepo;
    this.mappingRepo = mappingRepo;
    this.activityLogRepo = activityLogRepo;
    this.bitrix24 = bitrix24;
    this.connector = connector;
  }

  /**
   * OAuth install handler — GET / POST /api/connector/install
   * Bitrix24 opens this URL when the app is installed or re-authorized.
   */
  async handleInstall(req, res) {
    if (!env.ENABLE_OPENLINES_CONNECTOR) {
      return res.status(200).type('html').send(`
        <!DOCTYPE html>
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h3 style="color:#888">Open Lines Connector module is currently disabled (ENABLE_OPENLINES_CONNECTOR=false).</h3>
        </body></html>
      `);
    }

    let summary = { ok: false, memberId: null, registered: false, activated: false, error: null };

    try {
      const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
      const memberId = params.member_id || params.MEMBER_ID || req.body?.member_id;

      // 1. Exchange / save OAuth tokens from install payload
      let install = null;
      if (params.code) {
        install = await this.bitrix24.oauth.handleCallback({ code: params.code, domain: params.domain || params.DOMAIN, memberId });
      } else if (params.auth_id || params.AUTH_ID) {
        install = await this.bitrix24.oauth.installFromParams(params);
      } else {
        install = await this.installRepo.findActiveMostRecent();
      }

      if (!install) {
        throw new AppError('No installation parameters or OAuth code supplied', 400, null, 'B24_INSTALL_FAILED');
      }

      summary.memberId = install.memberId;
      this.bitrix24.activate(install.memberId);

      // 2. Register Connector tile ("whatsapp_b24_connector") in Contact Center
      const registerRes = await this.connector.register(install.memberId).catch((err) => {
        log.warn('imconnector.register error', { error: err.message });
        return { error: err.message };
      });
      summary.registered = !registerRes?.error;

      // 3. Bind event handlers and activate
      await this.connector.bindEvents(install.memberId).catch(() => {});
      
      const lineId = Number(env.BITRIX24_OPENLINE_ID) || install.lineId || 1;
      await this.connector.activate(install.memberId, { lineId, active: true }).catch(() => {});
      summary.activated = true;
      summary.ok = true;

      // 4. Record Activity Log in DB
      await this.activityLogRepo.log({
        tenantId: install.tenantId || null,
        action: 'CONNECTOR_REGISTERED',
        category: 'INTEGRATION',
        details: {
          memberId: install.memberId,
          domain: install.domain,
          connectorId: this.connector.connectorId(),
          registered: summary.registered,
        },
      }).catch(() => {});

      log.info('Open Lines Connector registered successfully', summary);
    } catch (err) {
      summary.error = err.message;
      log.error('Connector install failed', { error: err.message });
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>WhatsApp Connector Installation</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8f9fa;">
        <div style="max-width:500px;margin:auto;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
          <h2 style="color:${summary.ok ? '#27ae60' : '#e74c3c'}">${summary.ok ? '✓ WhatsApp Connector Installed' : '❌ Installation Issue'}</h2>
          <p style="color:#555;font-size:14px">${summary.ok ? 'The WhatsApp tile has been registered in your Bitrix24 Contact Center.' : summary.error}</p>
          <div style="margin-top:20px;font-size:12px;color:#888">
            Portal Member ID: <b>${summary.memberId || 'N/A'}</b>
          </div>
        </div>
      </body>
      </html>
    `;

    return res.status(200).type('html').send(html);
  }

  /**
   * Placement / Settings handler — GET / POST /api/connector/handler
   * Bitrix24 loads this page in an iframe when clicking "Connect" on the tile.
   */
  async handlePlacement(req, res) {
    let state = {
      ok: false,
      connected: false,
      memberId: null,
      lineId: null,
      lines: [],
      error: null,
      message: null,
    };

    try {
      const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
      const options = parsePlacementOptions(params.PLACEMENT_OPTIONS);
      let memberId = params.member_id || params.MEMBER_ID || req.body?.member_id || options.memberId || options.MEMBER_ID;

      let install = memberId ? await this.installRepo.findByMemberId(memberId).catch(() => null) : null;
      if (!install) {
        install = await this.installRepo.findActiveMostRecent().catch(() => null);
        if (install) memberId = install.memberId;
      }

      if (memberId) {
        state.memberId = memberId;
        this.bitrix24.activate(memberId);
      }

      const tenantId = install ? install.tenantId : null;

      // GET / Page Refresh State Lookup from Database
      if (memberId) {
        const activeMapping = await this.mappingRepo.findActiveByMember(memberId).catch(() => null);
        if (install && install.lineId) {
          state.lineId = Number(install.lineId);
          state.connected = true;
        } else if (activeMapping && activeMapping.lineId) {
          state.lineId = Number(activeMapping.lineId);
          state.connected = true;
        }
      }

      // Handle Disconnect Action
      if (req.method === 'POST' && req.body?.action === 'disconnect') {
        if (memberId && state.lineId) {
          const disconnectLineId = state.lineId;
          await this.connector.activate(memberId, { lineId: disconnectLineId, active: false }).catch(() => {});
          await this.mappingRepo.upsertMapping({
            tenantId,
            memberId,
            lineId: disconnectLineId,
            domain: params.domain || (install && install.domain) || 'bitrix24',
            status: 'INACTIVE',
          });
          await this.installRepo.updateOpenline(memberId, { lineId: null });

          state.connected = false;
          state.lineId = null;
          state.message = `Disconnected from Open Line #${disconnectLineId}.`;

          await this.activityLogRepo.log({
            tenantId,
            action: 'CONNECTOR_LINE_DISCONNECTED',
            category: 'INTEGRATION',
            details: { memberId, lineId: disconnectLineId },
          }).catch(() => {});
        }
      }
      // Handle Connect / Save Line Action
      else if (req.method === 'POST' && (req.body?.action === 'save_line' || req.body?.line_id)) {
        let targetLineId = Number(req.body.line_id);

        if (req.body.action === 'create_new_line' || !targetLineId) {
          const newLineRes = await this.bitrix24.call('imopenlines.config.add', {
            LINE_NAME: req.body.line_name || 'WhatsApp Open Line',
          });
          targetLineId = Number(newLineRes);
        }

        if (targetLineId && memberId) {
          const connectorId = this.connector.connectorId();
          await this.connector.activate(memberId, { lineId: targetLineId, active: true });
          await this.connector.setData(memberId, { lineId: targetLineId });

          await this.mappingRepo.upsertMapping({
            tenantId,
            memberId,
            lineId: targetLineId,
            domain: params.domain || (install && install.domain) || 'bitrix24',
            connectorId,
            lineName: req.body.line_name || `Line #${targetLineId}`,
            status: 'ACTIVE',
          });

          await this.installRepo.updateOpenline(memberId, { connectorId, lineId: targetLineId });

          state.lineId = targetLineId;
          state.connected = true;
          state.ok = true;
          state.message = `Successfully connected WhatsApp Connector to Open Line #${targetLineId}!`;

          await this.activityLogRepo.log({
            tenantId,
            action: 'CONNECTOR_LINE_LINKED',
            category: 'INTEGRATION',
            details: { memberId, lineId: targetLineId, connectorId },
          }).catch(() => {});
        }
      }

      // Fetch open lines list from Bitrix24
      try {
        const linesRes = await this.bitrix24.call('imopenlines.config.get', {});
        state.lines = Array.isArray(linesRes) ? linesRes : [];
      } catch {
        state.lines = [];
      }
    } catch (err) {
      state.error = err.message;
      log.warn('placement handler error', { error: err.message });
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Connector Settings</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; margin: 0; padding: 24px; color: #333; }
          .card { background: white; border-radius: 8px; padding: 24px; max-width: 520px; margin: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
          h3 { margin-top: 0; color: #075E54; display: flex; align-items: center; justify-content: space-between; }
          .badge-active { background: #e8f8f5; color: #27ae60; padding: 6px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; }
          .badge-inactive { background: #fbeee6; color: #d35400; padding: 6px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; }
          .form-group { margin-bottom: 16px; margin-top: 16px; }
          label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #555; }
          select, input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
          button.btn-connect { background: #075E54; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; width: 100%; font-size: 14px; margin-top: 8px; }
          button.btn-connect:hover { background: #128C7E; }
          button.btn-disconnect { background: #c0392b; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; width: 100%; font-size: 14px; margin-top: 16px; }
          button.btn-disconnect:hover { background: #e74c3c; }
          .alert { padding: 12px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
          .alert-success { background: #e8f8f5; color: #27ae60; border: 1px solid #a3e4d7; }
          .alert-error { background: #fadbd8; color: #c0392b; border: 1px solid #f5b7b1; }
          .info-box { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 12px; margin-top: 16px; font-size: 13px; color: #6c757d; }
        </style>
      </head>
      <body>
        <div class="card">
          <h3>
            <span>💬 WhatsApp Connector</span>
            <span class="${state.connected ? 'badge-active' : 'badge-inactive'}">${state.connected ? `✓ Connected (Line #${state.lineId})` : 'Disconnected'}</span>
          </h3>

          ${state.message ? `<div class="alert alert-success">${state.message}</div>` : ''}
          ${state.error ? `<div class="alert alert-error">${state.error}</div>` : ''}

          ${state.connected ? `
            <div class="info-box">
              This WhatsApp Connector is active and linked to <b>Open Line #${state.lineId}</b>. Incoming customer messages will appear live in your Open Channels chat.
            </div>

            <form method="POST">
              <input type="hidden" name="member_id" value="${state.memberId || ''}" />
              <input type="hidden" name="action" value="disconnect" />
              <button type="submit" class="btn-disconnect">Disconnect Connector</button>
            </form>
          ` : `
            <form method="POST">
              <input type="hidden" name="member_id" value="${state.memberId || ''}" />
              <input type="hidden" name="action" value="save_line" />

              <div class="form-group">
                <label>Select Open Line to Link:</label>
                <select name="line_id">
                  ${state.lines.length === 0 ? '<option value="1">Default Open Line (#1)</option>' : ''}
                  ${state.lines.map((l) => `<option value="${l.ID}" ${Number(l.ID) === Number(state.lineId) ? 'selected' : ''}>${l.LINE_NAME || `Line #${l.ID}`} (ID: ${l.ID})</option>`).join('')}
                </select>
              </div>

              <button type="submit" class="btn-connect">Link & Activate Open Line</button>
            </form>
          `}
        </div>
      </body>
      </html>
    `;

    return res.status(200).type('html').send(html);
  }
}

module.exports = { ConnectorModuleController };
