const { env } = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { InstallRepository } = require('../repositories');
const { Bitrix24Service, Bitrix24ConnectorService } = require('../services/bitrix24');

const log = logger.childFor('connector-placement');

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

function isActive(value) {
  if (value === undefined || value === null || value === '') return true;
  return String(value).toUpperCase() === 'Y' || String(value) === '1' || value === true;
}

/**
 * Open Channels placement handler (GET /app/connector).
 *
 * Bitrix24 opens this page in a Contact Center slider with the tokens in
 * the query string (same shape as GET /install) plus:
 *   PLACEMENT         - 'SETTING_CONNECTOR'
 *   PLACEMENT_OPTIONS - JSON { LINE, ACTIVE_STATUS, CONNECTOR, ... }
 *
 * The page re-validates the install, records the chosen line on the
 * install row and drives the connector lifecycle (activate + data.set +
 * event.bind) so operator replies can reach the Phase 4 webhook.
 */
class ConnectorController {
  constructor({
    installRepo = new InstallRepository(),
    bitrix24Service = new Bitrix24Service(),
    connectorService = new Bitrix24ConnectorService(),
  } = {}) {
    this.installRepo = installRepo;
    this.bitrix24 = bitrix24Service;
    this.connector = connectorService;
  }

  async handle(req, res) {
    let state = { configured: false, error: null, lineId: null, active: false, registered: null };

    try {
      const params = req.query || {};
      const memberId = params.member_id || params.MEMBER_ID;
      if (!memberId) {
        throw new AppError('Placement request is missing member_id', 400, null, 'B24_PLACEMENT_INVALID');
      }

      const install = await this.bitrix24.oauth.installFromParams(params);
      this.bitrix24.activate(install.memberId);

      // The page may be opened before the app is fully provisioned, so
      // (re)registering is idempotent and harmless.
      try {
        state.registered = await this.connector.register(install.memberId);
      } catch (err) {
        log.warn('connector.register failed from placement page', {
          memberId: install.memberId,
          code: err.code,
          message: err.message,
        });
      }

      const options = parsePlacementOptions(params.PLACEMENT_OPTIONS);
      const lineId = Number(options.LINE || options.line || env.BITRIX24_OPENLINE_ID) || null;
      const active = isActive(options.ACTIVE_STATUS);

      state.lineId = lineId;
      state.active = active && Boolean(lineId);

      if (lineId) {
        await this.installRepo.updateOpenline(install.memberId, {
          connectorId: this.connector.connectorId(),
          lineId,
        });
        state.configured = true;
      }

      if (active && lineId) {
        await this.connector.activate(install.memberId, { lineId, active: true });
        await this.connector.setData(install.memberId, { lineId });
      } else if (lineId) {
        await this.connector.activate(install.memberId, { lineId, active: false });
      }

      const bindings = await this.connector.bindEvents(install.memberId);
      const bindFailed = (bindings || []).filter((b) => !b.ok);
      if (bindFailed.length) {
        state.error = `event.bind failed: ${bindFailed.map((f) => f.event).join(', ')}`;
        log.warn('connector event binding failed from placement page', { memberId: install.memberId, bindings });
      }
    } catch (err) {
      state.error = err.message;
      log.warn('connector placement handling failed', { code: err.code, message: err.message });
    }

    const html = this._render(state);
    res.status(200).type('html').send(html);
  }

  _render(state) {
    const color = state.error ? '#c0392b' : state.configured ? '#1e8449' : '#8e8e8e';
    const title = state.error ? 'Connector setup failed' : state.active ? 'Connector active' : 'Connector configured';
    const body = state.error
      ? `Setup failed: ${state.error}`
      : state.lineId
        ? `Connected to open line ${state.lineId}.${state.active ? ' Active and receiving WhatsApp messages.' : ' Deactivated.'}`
        : 'No open line selected yet. Activate the connector from the Contact Center.';

    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;text-align:center;padding:40px">
  <h2 style="color:${color}">${title}</h2>
  <p>${body}</p>
  <p style="color:#888;font-size:12px">You can close this window.</p>
</body></html>`;
  }
}

module.exports = { ConnectorController };
