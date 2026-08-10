const { AuthService } = require('../services/auth.service');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');

class AuthController {
  constructor({
    authService = new AuthService(),
    activityLogRepo = new ActivityLogRepository(),
  } = {}) {
    this.authService = authService;
    this.activityLogRepo = activityLogRepo;
  }

  login = async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
      const result = await this.authService.login({ email, password, ipAddress });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  me = async (req, res, next) => {
    try {
      const result = await this.authService.getMe(req.user.id);
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  forgotPassword = async (req, res, next) => {
    try {
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
      const result = await this.authService.requestPasswordReset({
        email: req.body.email,
        ipAddress,
      });
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  resetPassword = async (req, res, next) => {
    try {
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
      const result = await this.authService.resetPassword({
        token: req.body.token,
        newPassword: req.body.newPassword,
        ipAddress,
      });
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  logout = async (req, res, next) => {
    try {
      if (req.user) {
        await this.activityLogRepo.log({
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'USER_LOGOUT',
          category: 'AUTH',
          ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        });
      }
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  AuthController,
  defaultController: new AuthController(),
};
