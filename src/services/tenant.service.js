const { TenantRepository } = require('../repositories/tenant.repository');
const { UserRepository } = require('../repositories/user.repository');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { Bitrix24Service } = require('./bitrix24');
const { WhatsBoxService } = require('./whatsbox');
const { hashPassword } = require('../utils/password');
const { normalizePhone } = require('../helpers/phone');
const AppError = require('../utils/AppError');
const { env } = require('../config');

class TenantService {
  constructor({
    tenantRepo = new TenantRepository(),
    userRepo = new UserRepository(),
    activityLogRepo = new ActivityLogRepository(),
  } = {}) {
    this.tenantRepo = tenantRepo;
    this.userRepo = userRepo;
    this.activityLogRepo = activityLogRepo;
  }

  async getSetupStatus(tenantId) {
    if (!tenantId) {
      return {
        isConfigured: true,
        whatsappWebhookUrl: env.WHATSAPP_WEBHOOK_URL || null,
        whatsboxChannelId: env.WHATSBOX_CHANNEL_ID || null,
        bitrix24WebhookUrl: env.BITRIX24_WEBHOOK_URL || null,
        status: 'ACTIVE',
      };
    }

    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new AppError('Tenant not found', 404, null, 'TENANT_NOT_FOUND');
    }

    return {
      isConfigured: tenant.isConfigured,
      whatsappWebhookUrl: tenant.whatsappWebhookUrl || env.WHATSAPP_WEBHOOK_URL || null,
      whatsboxChannelId: tenant.whatsboxChannelId || env.WHATSBOX_CHANNEL_ID || null,
      bitrix24WebhookUrl: tenant.bitrix24WebhookUrl || env.BITRIX24_WEBHOOK_URL || null,
      status: tenant.status,
      name: tenant.name,
      slug: tenant.slug,
    };
  }

  async saveSetup(tenantId, { whatsappWebhookUrl, whatsboxChannelId, bitrix24WebhookUrl, userId = null, ipAddress = null }) {
    if (!tenantId) {
      throw new AppError('Tenant context required for setup', 400, null, 'TENANT_REQUIRED');
    }

    const updateData = {};
    if (whatsappWebhookUrl !== undefined && whatsappWebhookUrl !== null && String(whatsappWebhookUrl).trim() !== '') {
      updateData.whatsappWebhookUrl = String(whatsappWebhookUrl).trim();
    }
    if (whatsboxChannelId !== undefined && whatsboxChannelId !== null && String(whatsboxChannelId).trim() !== '') {
      updateData.whatsboxChannelId = normalizePhone(whatsboxChannelId);
    }
    if (bitrix24WebhookUrl !== undefined && bitrix24WebhookUrl !== null && String(bitrix24WebhookUrl).trim() !== '') {
      updateData.bitrix24WebhookUrl = String(bitrix24WebhookUrl).trim();
    }

    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new AppError('Tenant not found', 404, null, 'TENANT_NOT_FOUND');
    }

    const finalWebhookUrl = updateData.whatsappWebhookUrl !== undefined ? updateData.whatsappWebhookUrl : (tenant.whatsappWebhookUrl || env.WHATSAPP_WEBHOOK_URL);
    const finalB24Url = updateData.bitrix24WebhookUrl !== undefined ? updateData.bitrix24WebhookUrl : (tenant.bitrix24WebhookUrl || env.BITRIX24_WEBHOOK_URL);

    // Test Bitrix24 Connection if URL provided
    let b24TestResult = { ok: true };
    if (finalB24Url) {
      try {
        const b24Service = new Bitrix24Service();
        b24Service.client = new (require('./bitrix24/client').Bitrix24Client)(finalB24Url);
        b24TestResult = await b24Service.testConnection();
      } catch (err) {
        logWarn('Bitrix24 test connection failed during setup:', err.message);
        b24TestResult = { ok: false, error: err.message };
      }
    }

    const isConfigured = Boolean(finalB24Url || finalWebhookUrl);
    updateData.isConfigured = isConfigured;

    const updated = await this.tenantRepo.update(tenantId, updateData);

    await this.activityLogRepo.log({
      tenantId,
      userId,
      action: 'INTEGRATION_SETUP_UPDATED',
      category: 'INTEGRATION',
      details: {
        hasWhatsappWebhook: Boolean(finalWebhookUrl),
        hasBitrix: Boolean(finalB24Url),
        isConfigured,
        b24TestOk: b24TestResult.ok,
      },
      ipAddress,
    });

    // Trigger instant contact sync so the dashboard is populated right after
    // the integration is saved (pull Bitrix24 contacts into the local DB).
    if (finalB24Url) {
      try {
        const { SyncService } = require('./sync.service');
        const syncService = new SyncService();
        syncService
          .syncContactsFromBitrix24(tenantId, { userId, ipAddress })
          .catch((err) => logWarn('Background contact pull-sync error:', err.message));
      } catch (e) {
        // silent catch
      }
    }

    // Also kick off a resync of any locally-created contacts that still await
    // being pushed up to Bitrix24 (only when the connection is confirmed).
    if (b24TestResult.ok) {
      try {
        const { ResyncContactsJob } = require('../jobs/resyncContacts.job');
        const job = new ResyncContactsJob();
        job.run().catch((err) => logWarn('Background resync trigger error:', err.message));
      } catch (e) {
        // silent catch
      }
    }

    return {
      success: true,
      tenant: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        isConfigured: updated.isConfigured,
      },
      connectionStatus: {
        bitrix24: b24TestResult,
      },
    };
  }

  async testConnection(tenantId) {
    let apiKey = env.WHATSBOX_API_KEY;
    let b24Url = env.BITRIX24_WEBHOOK_URL;

    if (tenantId) {
      const tenant = await this.tenantRepo.findById(tenantId);
      if (tenant) {
        if (tenant.whatsappWebhookUrl) apiKey = tenant.whatsappWebhookUrl;
        if (tenant.bitrix24WebhookUrl) b24Url = tenant.bitrix24WebhookUrl;
      }
    }

    const result = {
      whatsbox: { configured: Boolean(apiKey), ok: false },
      bitrix24: { configured: Boolean(b24Url), ok: false },
    };

    if (b24Url) {
      try {
        const b24Service = new Bitrix24Service();
        b24Service.client = new (require('./bitrix24/client').Bitrix24Client)(b24Url);
        const res = await b24Service.testConnection();
        result.bitrix24.ok = res.ok;
        result.bitrix24.result = res.result;
      } catch (err) {
        result.bitrix24.ok = false;
        result.bitrix24.error = err.message;
      }
    }

    if (apiKey) {
      try {
        const whatsboxService = new WhatsBoxService({ apiKey });
        const res = await whatsboxService.testConnection();
        result.whatsbox.ok = res.ok;
      } catch (err) {
        result.whatsbox.ok = false;
        result.whatsbox.error = err.message;
      }
    } else {
      result.whatsbox.ok = true;
      result.whatsbox.note = 'Default development mode';
    }

    return result;
  }

  async createTenant({ name, slug, adminEmail, adminPassword, adminName }) {
    if (!name || !slug || !adminEmail || !adminPassword) {
      throw new AppError('Name, slug, adminEmail, and adminPassword are required', 400, null, 'INVALID_INPUT');
    }

    const existingSlug = await this.tenantRepo.findBySlug(slug);
    if (existingSlug) {
      throw new AppError(`Tenant with slug "${slug}" already exists`, 400, null, 'SLUG_TAKEN');
    }

    const existingUser = await this.userRepo.findByEmail(adminEmail);
    if (existingUser) {
      throw new AppError(`User with email "${adminEmail}" already exists`, 400, null, 'EMAIL_TAKEN');
    }

    const tenant = await this.tenantRepo.create({
      name,
      slug: slug.toLowerCase().trim(),
      status: 'ACTIVE',
      isConfigured: false,
    });

    const passwordHash = await hashPassword(adminPassword);
    const adminUser = await this.userRepo.create({
      tenantId: tenant.id,
      email: adminEmail,
      passwordHash,
      name: adminName || `${name} Admin`,
      role: 'ADMIN',
    });

    await this.activityLogRepo.log({
      tenantId: tenant.id,
      userId: adminUser.id,
      action: 'TENANT_CREATED',
      category: 'SYSTEM',
      details: { tenantName: name, slug, adminEmail },
    });

    return { tenant, adminUser };
  }

  async listTenants({ skip = 0, limit = 50, status } = {}) {
    return this.tenantRepo.list({ skip, limit, status });
  }
}

function logWarn(...args) {
  console.warn('[TenantService]', ...args);
}

module.exports = { TenantService };
