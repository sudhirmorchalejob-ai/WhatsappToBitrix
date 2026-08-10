const { z } = require('zod');

/**
 * POST /api/auth/forgot-password — request a password-reset email.
 */
const forgotPasswordSchema = z.object({
  email: z.string().trim().email('A valid email is required').max(255),
});

/**
 * POST /api/auth/reset-password — set a new password with a reset token.
 */
const resetPasswordSchema = z.object({
  token: z.string().trim().min(10, 'Reset token is invalid').max(512),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});

module.exports = {
  forgotPasswordSchema,
  resetPasswordSchema,
};
