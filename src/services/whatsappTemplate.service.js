const axios = require('axios');
const { env } = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { WhatsAppTemplateRepository } = require('../repositories/whatsappTemplate.repository');

const log = logger.childFor('whatsapp-template-service');

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class WhatsAppTemplateService {
  constructor({
    repo = new WhatsAppTemplateRepository(),
    apiBase = null,
    accessToken = null,
    wabaId = null,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  } = {}) {
    this.repo = repo;
    this.apiBase = (apiBase || env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
    this.accessToken = accessToken || env.WHATSAPP_ACCESS_TOKEN;
    this.wabaId = wabaId || env.WHATSAPP_WABA_ID;
    this.cacheTtlMs = cacheTtlMs;
    this._cache = new Map(); // key -> { data, expiresAt }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Fetch all templates from Meta Graph API, upsert into DB, and return
   * the persisted rows. Results are cached in-memory for cacheTtlMs.
   */
  async fetchAndCache(tenantId = null, { force = false } = {}) {
    const cacheKey = `templates:${tenantId || 'default'}`;
    if (!force) {
      const cached = this._cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        log.debug('returning cached templates', { tenantId, count: cached.data.length });
        return cached.data;
      }
    }

    const rawTemplates = await this._fetchFromApi();
    const rows = await this.repo.upsertMany(tenantId, rawTemplates);

    this._cache.set(cacheKey, { data: rows, expiresAt: Date.now() + this.cacheTtlMs });
    log.info('templates synced from Meta API', { tenantId, count: rows.length });
    return rows;
  }

  /**
   * List templates already persisted in DB (no API call).
   */
  async list(tenantId = null, filters = {}) {
    return this.repo.list({ tenantId, ...filters });
  }

  /**
   * Get a single template by name + language from DB.
   */
  async getByName(templateName, language, tenantId = null) {
    return this.repo.findByNameAndLanguage(templateName, language, tenantId);
  }

  /**
   * Build the WhatsApp template message payload for WhatsBox gateway.
   */
  static buildTemplatePayload({ template, to, params = [], channelId, name }) {
    const components = [];

    // Header component (if template has a header)
    if (template && template.headerType && template.headerType !== 'TEXT') {
      // MEDIA headers (image/video/document) are handled separately
    } else if (template && template.headerText) {
      components.push({
        type: 'header',
        parameters: [{ type: 'text', text: template.headerText }],
      });
    }

    // Body component with parameters
    if (params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: String(p) })),
      });
    }

    return {
      to,
      name,
      channelId,
      template: {
        name: template.templateName,
        language: { code: template.language },
        components: components.length ? components : undefined,
      },
    };
  }

  // ------------------------------------------------------------------
  // Meta Graph API
  // ------------------------------------------------------------------

  async _fetchFromApi() {
    this._assertConfigured();

    const allTemplates = [];
    let url = `${this.apiBase}/${this.wabaId}/message_templates`;
    let params = {
      access_token: this.accessToken,
      limit: 100,
      status: ['APPROVED', 'ACTIVE'],
    };

    while (url) {
      const response = await axios.get(url, { params, timeout: 30000 });
      const body = response.data;

      if (body.data) {
        for (const tpl of body.data) {
          allTemplates.push(this._normalizeTemplate(tpl));
        }
      }

      // Pagination
      url = body.paging && body.paging.next ? body.paging.next : null;
      params = {}; // next URL already contains all params
    }

    log.info('fetched templates from Meta API', { count: allTemplates.length });
    return allTemplates;
  }

  _normalizeTemplate(raw) {
    const components = raw.components || [];
    const bodyComponent = components.find((c) => c.type === 'BODY');
    const headerComponent = components.find((c) => c.type === 'HEADER');
    const buttons = components.filter((c) => c.type === 'BUTTONS' || c.type === 'BUTTON');

    return {
      templateName: raw.name,
      category: (raw.category || 'UTILITY').toUpperCase(),
      language: raw.language || 'en',
      status: (raw.status || 'ACTIVE').toUpperCase(),
      bodyText: bodyComponent ? bodyComponent.text : null,
      headerType: headerComponent ? (headerComponent.format || 'TEXT').toUpperCase() : null,
      headerText: headerComponent && headerComponent.format === 'TEXT' ? headerComponent.text : null,
      buttons: buttons.length ? buttons : null,
      components: components.length ? components : null,
      raw,
    };
  }

  _assertConfigured() {
    if (!this.accessToken) {
      throw new AppError(
        'WhatsApp Access Token is not configured (WHATSAPP_ACCESS_TOKEN)',
        503, null, 'WHATSAPP_NOT_CONFIGURED'
      );
    }
    if (!this.wabaId) {
      throw new AppError(
        'WhatsApp Business Account ID is not configured (WHATSAPP_WABA_ID)',
        503, null, 'WHATSAPP_NOT_CONFIGURED'
      );
    }
  }
}

module.exports = { WhatsAppTemplateService };
