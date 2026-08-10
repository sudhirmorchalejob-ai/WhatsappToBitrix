const crypto = require('crypto');
const logger = require('../utils/logger');
const { UserRepository } = require('../repositories/user.repository');
const { TenantRepository } = require('../repositories/tenant.repository');
const { ActivityLogRepository } = require('../repositories/activityLog.repository');
const { comparePassword, hashPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const { env } = require('../config');
const { MsGraphEmailService } = require('./email/msGraph.service');

const log = logger.childFor('auth');
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

class AuthService {
  constructor({
    userRepo = new UserRepository(),
    tenantRepo = new TenantRepository(),
    activityLogRepo = new ActivityLogRepository(),
    emailService = new MsGraphEmailService(),
  } = {}) {
    this.userRepo = userRepo;
    this.tenantRepo = tenantRepo;
    this.activityLogRepo = activityLogRepo;
    this.emailService = emailService;
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

  /**
   * Starts the password-reset flow. Always responds the same way whether
   * the email exists or not (avoids user enumeration). Emails a one-time
   * reset link that expires in 1 hour.
   */
  async requestPasswordReset({ email, ipAddress = null }) {
    if (!email) {
      throw new AppError('Email is required', 400, null, 'INVALID_INPUT');
    }

    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      logForgot(this.activityLogRepo, { email, ipAddress, reason: 'unknown-email' });
      return { ok: true, emailed: false };
    }

    if (!this.emailService.isConfigured()) {
      throw new AppError(
        'Password reset email is not configured on this server. Please contact your administrator.',
        500,
        null,
        'EMAIL_NOT_CONFIGURED'
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    await this.userRepo.update(user.id, {
      resetPasswordToken: hashResetToken(token),
      resetPasswordExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const base = env.FRONTEND_URL || env.APP_BASE_URL || 'http://localhost:9191';
    const resetLink = `${base}/?view=reset&token=${token}`;

    try {
      await this.emailService.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetLink,
      });
    } catch (err) {
      log.warn('password-reset email send failed', { userId: user.id, message: err.message });
      throw new AppError(
        'We could not send the reset email right now. Please try again later.',
        500,
        null,
        'EMAIL_SEND_FAILED'
      );
    }

    await this.activityLogRepo.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      category: 'AUTH',
      details: { email: user.email },
      ipAddress,
    });

    return { ok: true, emailed: true };
  }

  /**
   * Completes the reset: validates the token, sets the new password and
   * clears the reset token so it can't be reused.
   */
  async resetPassword({ token, newPassword, ipAddress = null }) {
    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400, null, 'INVALID_INPUT');
    }
    if (String(newPassword).length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400, null, 'WEAK_PASSWORD');
    }

    const user = await this.userRepo.findByResetToken(hashResetToken(token));
    if (!user) {
      throw new AppError('This reset link is invalid or has already been used', 400, null, 'INVALID_RESET_TOKEN');
    }

    if (!user.resetPasswordExpires || new Date(user.resetPasswordExpires).getTime() < Date.now()) {
      throw new AppError('This reset link has expired. Please request a new one.', 400, null, 'RESET_TOKEN_EXPIRED');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.userRepo.update(user.id, {
      passwordHash,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });

    await this.activityLogRepo.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      category: 'AUTH',
      details: { email: user.email },
      ipAddress,
    });

    return { ok: true, email: user.email };
  }
}

// Fire-and-forget helper so unknown-email requests don't throw.
function logForgot(repo, entry) {
  try {
    repo.log({
      tenantId: null,
      userId: null,
      action: 'PASSWORD_RESET_REQUESTED',
      category: 'AUTH',
      details: { email: entry.email, reason: entry.reason },
      ipAddress: entry.ipAddress,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

module.exports = { AuthService };
