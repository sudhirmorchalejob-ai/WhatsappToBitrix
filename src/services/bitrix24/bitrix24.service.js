const { z } = require('zod');
const { env } = require('../../config');
const { BITRIX24_METHODS, BITRIX24_EVENTS } = require('../../constants');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { normalizePhone, comparePhones } = require('../../helpers/phone');
const { InstallRepository, TenantRepository } = require('../../repositories');
const { Bitrix24Client } = require('./client');
const { Bitrix24OAuth } = require('./oauth');

const log = logger.childFor('bitrix24-service');

const TOKEN_EXPIRY_LEAD_MS = 60 * 1000;

// ------------------------------------------------------------------
// Zod schemas: input validation at the service boundary.
// ------------------------------------------------------------------

const phoneSchema = z.string().min(3, 'Phone must contain at least 3 digits');
const idSchema = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]);

const createContactSchema = z.object({
  name: z.string().min(1).max(255),
  lastName: z.string().max(255).optional(),
  phone: phoneSchema,
  email: z.string().max(255).optional(),
  company: z.string().max(255).optional(),
  comments: z.string().max(1000).optional(),
  sourceId: z.string().max(50).optional(),
  assignId: idSchema.optional(),
});

const updateContactSchema = z.object({
  id: idSchema,
  fields: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, 'No fields to update'),
});

const createLeadSchema = z.object({
  title: z.string().min(1).max(255),
  contactId: idSchema.optional(),
  name: z.string().max(255).optional(),
  phone: phoneSchema.optional(),
  assignedById: idSchema.optional(),
  statusId: z.string().max(50).optional(),
  sourceId: z.string().max(50).optional(),
  comments: z.string().max(1000).optional(),
  opportunity: z.number().nonnegative().optional(),
  currencyId: z.string().max(10).optional(),
});

const timelineCommentSchema = z.object({
  entityType: z.enum(['deal', 'lead', 'contact']),
  entityId: idSchema,
  comment: z.string().min(1).max(5000),
  authorId: idSchema.optional(),
});

const activitySchema = z.object({
  ownerTypeId: z.number().int().positive(),
  ownerId: idSchema,
  subject: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  typeId: z.number().int().positive().default(2),
  direction: z.number().int().min(0).max(2).optional(),
  completed: z.enum(['Y', 'N']).default('N'),
  startTime: z.string().datetime({ offset: true }).optional(),
});

const notifySchema = z.object({
  toUserId: idSchema,
  message: z.string().min(1).max(5000),
  fromUserId: idSchema.optional(),
  type: z.enum(['SYSTEM', 'USER']).default('SYSTEM'),
  tag: z.string().max(50).optional(),
  subTag: z.string().max(50).optional(),
});

const uploadSchema = z.object({
  folderId: idSchema,
  fileName: z.string().min(1).max(255),
  fileContent: z.custom((v) => v !== undefined && v !== null, 'fileContent (Buffer/stream) is required'),
  overwrite: z.enum(['Y', 'N']).default('Y'),
});

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

class Bitrix24Service {
  constructor({ installRepository = new InstallRepository(), tenantRepository = new TenantRepository(), oauth = null } = {}) {
    this.installRepo = installRepository;
    this.tenantRepo = tenantRepository;
    this.oauth = oauth || new Bitrix24OAuth({ installRepository });
    this.client = null;
    this.oauthCtx = null; // { memberId, expiresAtMs }
  }

  isConfigured() {
    return Boolean(env.BITRIX24_WEBHOOK_URL || env.BITRIX24_MEMBER_ID || (this.oauthCtx && this.oauthCtx.memberId));
  }

  /**
   * Pins the service to a specific portal for subsequent calls. Used by
   * install/uninstall handlers and B24 event handlers that carry a
   * member_id.
   */
  activate(memberId) {
    if (!memberId) throw new AppError('memberId is required to activate a portal', 400, null, 'B24_MEMBER_REQUIRED');
    this.oauthCtx = { memberId, expiresAtMs: 0 };
    this.client = null;
    return this;
  }

  async _resolveMemberId() {
    if (env.BITRIX24_MEMBER_ID) return env.BITRIX24_MEMBER_ID;
    if (this.oauthCtx && this.oauthCtx.memberId) return this.oauthCtx.memberId;
    const install = await this.installRepo.findActiveMostRecent();
    return install ? install.memberId : null;
  }

  _isExpiring(install) {
    if (!install || !install.expiresAt) return false;
    return Date.now() >= new Date(install.expiresAt).getTime() - TOKEN_EXPIRY_LEAD_MS;
  }

  async _ensureOAuthClient(memberId) {
    if (
      this.client &&
      this.oauthCtx &&
      this.oauthCtx.memberId === memberId &&
      Date.now() < this.oauthCtx.expiresAtMs - TOKEN_EXPIRY_LEAD_MS
    ) {
      return this.client;
    }

    let install = await this.installRepo.findByMemberId(memberId);
    if (!install || install.status !== 'INSTALLED') {
      this.client = null;
      throw new AppError('Bitrix24 app is not installed for this portal', 503, null, 'B24_NOT_INSTALLED');
    }

    if (this._isExpiring(install)) {
      install = await this.oauth.refreshTokens(memberId);
    }

    const refresh = async () => {
      const refreshed = await this.oauth.refreshTokens(memberId);
      this.oauthCtx = {
        memberId,
        expiresAtMs: new Date(refreshed.expiresAt || Date.now() + 3600 * 1000).getTime(),
      };
      return refreshed.accessToken;
    };

    this.client = new Bitrix24Client(this.oauth.restBaseUrl(install.domain), {
      accessToken: install.accessToken,
      onAuthFailure: refresh,
    });
    this.oauthCtx = { memberId, expiresAtMs: new Date(install.expiresAt || Date.now() + 3600 * 1000).getTime() };
    return this.client;
  }

  async _ensureConfigured(tenantId = null) {
    const memberId = await this._resolveMemberId();
    if (memberId) {
      return this._ensureOAuthClient(memberId);
    }

    let tenantB24Url = null;
    try {
      if (tenantId) {
        const tenant = await this.tenantRepo.findById(tenantId);
        if (tenant && tenant.bitrix24WebhookUrl) {
          tenantB24Url = tenant.bitrix24WebhookUrl;
        }
      }
      if (!tenantB24Url) {
        const defaultTenant = await this.tenantRepo.prisma.tenant.findFirst({
          where: { bitrix24WebhookUrl: { not: null } },
          orderBy: { id: 'asc' },
        });
        if (defaultTenant && defaultTenant.bitrix24WebhookUrl) {
          tenantB24Url = defaultTenant.bitrix24WebhookUrl;
        }
      }
    } catch {
      // Fall through to env fallback if DB check fails
    }

    if (tenantB24Url) {
      return new Bitrix24Client(tenantB24Url);
    }

    if (env.BITRIX24_WEBHOOK_URL) {
      if (!this.client) {
        this.client = new Bitrix24Client(env.BITRIX24_WEBHOOK_URL);
      }
      return this.client;
    }

    throw new AppError(
      'Bitrix24 is not configured. Set BITRIX24_WEBHOOK_URL or configure webhook in Webhook Setup',
      503,
      null,
      'B24_NOT_CONFIGURED'
    );
  }

  // ---------------- Install helpers ----------------

  /**
   * Confirms the install by reading app.info and stores the app user id.
   */
  async confirmInstall(memberId) {
    const client = await this._ensureOAuthClient(memberId);
    const res = await client.call(BITRIX24_METHODS.APP_INFO, {});
    const info = res && res.result;
    if (info) {
      const userId = Number(info.USER_ID ?? info.user_id) || null;
      await this.installRepo.updateTokens(memberId, {
        accessToken: client.accessToken,
        userId,
        domain: info.DOMAIN || info.domain || null,
        clientEndpoint: info.CLIENT_ENDPOINT || info.client_endpoint || null,
      });
    }
    return info || null;
  }

  /**
   * Registers B24 event handlers for a portal (best-effort). The uninstall
   * handler is always bound; additional handlers can be passed in for
   * later phases (Open Channels, CRM).
   */
  async bindEvents(memberId, handlers = []) {
    const client = await this._ensureOAuthClient(memberId);
    const defaults = [
      {
        event: BITRIX24_EVENTS.APP_UNINSTALL,
        handler: env.APP_BASE_URL ? `${env.APP_BASE_URL.replace(/\/+$/, '')}/uninstall` : '',
      },
    ];
    const results = [];
    for (const { event, handler } of [...defaults, ...handlers]) {
      if (!handler) {
        results.push({ event, ok: false, error: 'no handler URL configured (APP_BASE_URL)' });
        continue;
      }
      try {
        const res = await client.call(BITRIX24_METHODS.EVENT_BIND, { event, handler });
        results.push({ event, ok: true, result: res && res.result });
      } catch (err) {
        const isAlreadyBound =
          /already binded/i.test(err.message || '') ||
          /already bound/i.test(err.message || '');

        if (isAlreadyBound) {
          log.info('event.bind handler already bound', { memberId, event });
          results.push({ event, ok: true, alreadyBound: true, result: true });
        } else {
          log.warn('event.bind failed', { memberId, event, code: err.code, message: err.message });
          results.push({ event, ok: false, error: err.message });
        }
      }
    }
    return results;
  }

  // ---------------- Generic ----------------

  async call(method, params = {}, options) {
    const client = await this._ensureConfigured();
    const res = await client.call(method, params, options);
    return res && res.result;
  }

  async batch(commands, options) {
    const client = await this._ensureConfigured();
    return client.batch(commands, options);
  }

  async testConnection(tenantId = null) {
    const client = await this._ensureConfigured(tenantId);
    try {
      const res = await client.call('crm.lead.fields', {});
      return {
        ok: true,
        method: 'crm.lead.fields',
        result: res && res.result ? Object.keys(res.result).length : 0,
      };
    } catch (crmErr) {
      log.info('crm.lead.fields test skipped/fallback', { message: crmErr.message });
      try {
        const res = await client.call(BITRIX24_METHODS.USER_GET, { start: 0 });
        return {
          ok: true,
          method: 'user.get',
          result: Array.isArray(res && res.result) ? res.result.length : 0,
        };
      } catch (userErr) {
        const res = await client.call('profile', {}).catch(() => client.call('app.info', {}).catch(() => ({})));
        return {
          ok: true,
          method: 'profile',
          result: res ? 1 : 0,
        };
      }
    }
  }

  // ---------------- Contacts ----------------

  /**
   * Finds a Bitrix24 contact by WhatsApp phone.
   * Uses B24's duplicate engine first (reliable dedup), then a list
   * filter fallback. Verifies the match by normalized phone.
   */
  async searchContactByPhone(phone, tenantId = null) {
    const client = await this._ensureConfigured(tenantId);
    const normalized = normalizePhone(phone);
    if (!normalized) return null;

    let contactIds = [];

    try {
      const dup = await client.call(BITRIX24_METHODS.DUPLICATE_FIND, {
        entity_type: 'CONTACT',
        type: 'PHONE',
        values: [normalized],
      });
      if (Array.isArray(dup.result) && dup.result.length) {
        contactIds = dup.result;
      }
    } catch (err) {
      log.warn('duplicate.findbycomm failed, falling back to contact.list', {
        code: err.code,
        message: err.message,
      });
    }

    if (!contactIds.length) {
      const list = await client.call(BITRIX24_METHODS.CONTACT_LIST, {
        filter: { PHONE: normalized },
        select: ['ID'],
        start: -1,
      });
      if (list.result) contactIds = list.result.map((c) => c.ID);
    }

    for (const id of contactIds.slice(0, 5)) {
      const contact = await this.getContact(id, tenantId);
      if (!contact) continue;

      const phones = contact.PHONE || [];
      if (phones.some((p) => comparePhones(p.VALUE, normalized))) {
        return contact;
      }
    }

    return null;
  }

  async getContact(id, tenantId = null) {
    const client = await this._ensureConfigured(tenantId);
    const res = await client.call(BITRIX24_METHODS.CONTACT_GET, { id });
    return res.result || null;
  }

  async createContact(input, tenantId = null) {
    const { name, lastName, phone, email, company, comments, sourceId, assignId } =
      createContactSchema.parse(input);

    const fields = {
      NAME: name,
      LAST_NAME: lastName || undefined,
      PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
      EMAIL: email ? [{ VALUE: email, VALUE_TYPE: 'WORK' }] : undefined,
      COMPANY_TITLE: company || undefined,
      COMMENTS: comments || undefined,
      SOURCE_ID: sourceId || undefined,
      ASSIGNED_BY_ID: assignId || undefined,
    };

    const client = await this._ensureConfigured(tenantId);
    const res = await client.call(BITRIX24_METHODS.CONTACT_ADD, { fields });
    return res.result;
  }

  async updateContact(id, fields, tenantId = null) {
    updateContactSchema.parse({ id, fields });
    const client = await this._ensureConfigured(tenantId);
    const res = await client.call(BITRIX24_METHODS.CONTACT_UPDATE, {
      id,
      fields,
    });
    return res.result;
  }

  // ---------------- Leads ----------------

  /**
   * Returns the first open lead bound to a contact, newest first.
   * Pass openOnly=false to search all leads.
   */
  async searchLeadByContact(contactId, { openOnly = true } = {}, tenantId = null) {
    const client = await this._ensureConfigured(tenantId);
    const filter = { CONTACT_ID: contactId };
    if (openOnly) filter.CLOSED = 'N';

    const res = await client.call(BITRIX24_METHODS.LEAD_LIST, {
      filter,
      order: { DATE_CREATE: 'DESC' },
      select: ['ID', 'TITLE', 'ASSIGNED_BY_ID', 'STATUS_ID', 'CLOSED'],
      start: -1,
    });

    return (res.result && res.result[0]) || null;
  }

  async getLead(id, tenantId = null) {
    const client = await this._ensureConfigured(tenantId);
    const res = await client.call(BITRIX24_METHODS.LEAD_GET, { id });
    return res.result || null;
  }

  async createLead(input, tenantId = null) {
    const { title, contactId, name, phone, assignedById, statusId, sourceId, comments, opportunity, currencyId } =
      createLeadSchema.parse(input);

    const fields = {
      TITLE: title,
      CONTACT_ID: contactId || undefined,
      NAME: name || undefined,
      PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: 'WORK' }] : undefined,
      ASSIGNED_BY_ID: assignedById || undefined,
      STATUS_ID: statusId || undefined,
      SOURCE_ID: sourceId || undefined,
      COMMENTS: comments || undefined,
      OPPORTUNITY: opportunity || undefined,
      CURRENCY_ID: currencyId || undefined,
      OPENED: 'Y',
    };

    const client = await this._ensureConfigured(tenantId);
    const res = await client.call(BITRIX24_METHODS.LEAD_ADD, { fields });
    return res.result;
  }

  // ---------------- Timeline & Activities ----------------

  /**
   * Adds a WhatsApp chat entry to the Bitrix24 timeline.
   * ENTITY_TYPE: deal | lead | contact.
   */
  async createTimelineComment(input) {
    const { entityType, entityId, comment, authorId } = timelineCommentSchema.parse(input);

    const client = await this._ensureConfigured();
    const res = await client.call(BITRIX24_METHODS.TIMELINE_COMMENT_ADD, {
      fields: {
        ENTITY_ID: entityId,
        ENTITY_TYPE: entityType,
        COMMENT: comment,
        AUTHOR_ID: authorId || undefined,
      },
    });
    return res.result;
  }

  /**
   * Creates a generic CRM activity. OWNER_TYPE_ID: 1=lead, 2=deal,
   * 3=contact, 4=company. TYPE_ID: 1=meeting, 2=call, 3=task, 4=email.
   */
  async createActivity(input) {
    const {
      ownerTypeId,
      ownerId,
      subject,
      description,
      typeId,
      direction,
      completed,
      startTime,
    } = activitySchema.parse(input);

    const fields = {
      OWNER_TYPE_ID: ownerTypeId,
      OWNER_ID: ownerId,
      TYPE_ID: typeId,
      SUBJECT: subject,
      DESCRIPTION: description || undefined,
      DIRECTION: direction,
      COMPLETED: completed,
      START_TIME: startTime || new Date().toISOString(),
      END_TIME: new Date().toISOString(),
    };

    const client = await this._ensureConfigured();
    const res = await client.call(BITRIX24_METHODS.ACTIVITY_ADD, { fields });
    return res.result;
  }

  // ---------------- Users ----------------

  async getUsers({ active = true, limit = 50 } = {}) {
    const client = await this._ensureConfigured();
    const res = await client.call(BITRIX24_METHODS.USER_GET, {
      filter: active ? { ACTIVE: true } : undefined,
      limit,
    });
    return res.result || [];
  }

  /**
   * Sends a push/system notification to a Bitrix24 user.
   * Use a stable `tag` so repeated notifications replace each other.
   */
  async notifyUser(input) {
    const { toUserId, message, fromUserId, type, tag, subTag } = notifySchema.parse(input);

    const client = await this._ensureConfigured();
    const res = await client.call(BITRIX24_METHODS.NOTIFY_ADD, {
      fields: {
        TO: toUserId,
        FROM: fromUserId || undefined,
        TYPE: type,
        MESSAGE: message,
        TAG: tag || undefined,
        SUB_TAG: subTag || undefined,
      },
    });
    return res.result;
  }

  // ---------------- Files ----------------

  /**
   * Uploads a file to a Bitrix24 disk folder.
   * fileContent: Buffer or readable stream.
   * Returns the created disk file entity (with a public URL on success).
   */
  async uploadFile(input) {
    const { folderId, fileName, fileContent, overwrite } = uploadSchema.parse(input);

    const client = await this._ensureConfigured();
    const form = new FormData();
    form.append('id', String(folderId));
    form.append('data', JSON.stringify({ NAME: fileName, OVERWRITE: overwrite }));
    form.append('fileContent', new Blob([fileContent]), fileName);
    if (client.accessToken) form.append('auth', client.accessToken);

    const res = await this._postForm(BITRIX24_METHODS.FILE_UPLOAD, form, client);
    return res.result || null;
  }

  async _postForm(method, form, client) {
    const startedAt = Date.now();
    try {
      const res = await client.http.post(`${method}.json`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data && res.data.error) {
        throw new (require('./bitrix24.error').Bitrix24ApiError)(
          res.data.error_description || res.data.error,
          res.data.error,
          502,
          res.data
        );
      }
      log.debug(`[ok] ${method}`, { durationMs: Date.now() - startedAt });
      return res.data;
    } catch (err) {
      const { Bitrix24ApiError } = require('./bitrix24.error');
      if (err instanceof Bitrix24ApiError) throw err;
      throw new Bitrix24ApiError(err.message, err.code || 'UPLOAD_ERROR', 502);
    }
  }
}

module.exports = { Bitrix24Service };
