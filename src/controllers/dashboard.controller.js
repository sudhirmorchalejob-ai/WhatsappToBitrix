const { DashboardService } = require('../services/dashboard.service');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');

class DashboardController {
  constructor({
    dashboardService = new DashboardService(),
    activityLogRepo = new ActivityLogRepository(),
  } = {}) {
    this.dashboardService = dashboardService;
    this.activityLogRepo = activityLogRepo;
  }

  getStats = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const data = await this.dashboardService.getStats(tenantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getTrends = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const days = req.query.days ? Number(req.query.days) : 14;
      const data = await this.dashboardService.getLeadTrends(tenantId, days);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getActivities = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const category = req.query.category || null;

      const data = await this.activityLogRepo.list({
        tenantId,
        category,
        limit,
        skip,
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getHistory = async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const data = await this.dashboardService.getHistory(tenantId, { limit });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  DashboardController,
  defaultController: new DashboardController(),
};
