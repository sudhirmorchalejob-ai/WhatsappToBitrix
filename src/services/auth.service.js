const { UserRepository } = require('../repositories/user.repository');
const { TenantRepository } = require('../repositories/tenant.repository');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

class AuthService {
  constructor({
    userRepo = new UserRepository(),
    tenantRepo = new TenantRepository(),
    activityLogRepo = new ActivityLogRepository(),
  } = {}) {
    this.userRepo = userRepo;
    this.tenantRepo = tenantRepo;
    this.activityLogRepo = activityLogRepo;
  }

  async login({ email, password, ipAddress = null }) {
    if (!email || !password) {
      throw new AppError('Email and password are required', 400, null, 'INVALID_INPUT');
    }

    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new AppError('Invalid email or password', 401, null, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated', 403, null, 'ACCOUNT_DISABLED');
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await this.activityLogRepo.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'FAILED_LOGIN',
        category: 'AUTH',
        details: { email, reason: 'Invalid password' },
        ipAddress,
      });
      throw new AppError('Invalid email or password', 401, null, 'INVALID_CREDENTIALS');
    }

    // Update lastLoginAt
    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    // Generate JWT
    const token = signToken({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    await this.activityLogRepo.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'USER_LOGIN',
      category: 'AUTH',
      details: { email: user.email, role: user.role },
      ipAddress,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant,
      },
    };
  }

  async getMe(userId) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, null, 'USER_NOT_FOUND');
    }

    let isConfigured = false;
    let tenant = null;

    if (user.tenantId) {
      tenant = await this.tenantRepo.findById(user.tenantId);
      if (tenant) {
        isConfigured = Boolean(
          tenant.isConfigured ||
          (tenant.whatsappWebhookUrl && tenant.bitrix24WebhookUrl)
        );
      }
    } else if (user.role === 'SUPER_ADMIN') {
      isConfigured = true;
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        lastLoginAt: user.lastLoginAt,
      },
      tenant: tenant ? {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        isConfigured: tenant.isConfigured,
        hasWhatsappWebhook: Boolean(tenant.whatsappWebhookUrl),
        hasBitrix: Boolean(tenant.bitrix24WebhookUrl),
      } : null,
      isConfigured,
    };
  }
}

module.exports = { AuthService };
