const { TenantService } = require('../services/tenant.service');
const { SyncService } = require('../services/sync.service');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');

class TenantController {
  constructor({
    tenantService = new TenantService(),
    syncService = new SyncService(),
    activityLogRepo = new ActivityLogRepository(),
  } = {}) {
    this.tenantService = tenantService;
    this.syncService = syncService;
    this.activityLogRepo = activityLogRepo;
  }

  getSetupStatus = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const data = await this.tenantService.getSetupStatus(tenantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  saveSetup = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const { whatsappWebhookUrl, whatsboxChannelId, bitrix24WebhookUrl } = req.body || {};
      const userId = req.user ? req.user.id : null;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

      const data = await this.tenantService.saveSetup(tenantId, {
        whatsappWebhookUrl,
        whatsboxChannelId,
        bitrix24WebhookUrl,
        userId,
        ipAddress,
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  testConnection = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const data = await this.tenantService.testConnection(tenantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  syncNow = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const userId = req.user ? req.user.id : null;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

      const data = await this.syncService.syncContactsFromBitrix24(tenantId, {
        userId,
        ipAddress,
        limit: Number(req.query.limit) || 200,
      });

      res.json({ success: data.ok, data });
    } catch (err) {
      next(err);
    }
  };

  createTenant = async (req, res, next) => {
    try {
      const { name, slug, adminEmail, adminPassword, adminName } = req.body || {};
      const data = await this.tenantService.createTenant({
        name,
        slug,
        adminEmail,
        adminPassword,
        adminName,
      });

      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  listTenants = async (req, res, next) => {
    try {
      const { skip = 0, limit = 50, status } = req.query;
      const data = await this.tenantService.listTenants({
        skip: Number(skip),
        limit: Number(limit),
        status,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  TenantController,
  defaultController: new TenantController(),
};
