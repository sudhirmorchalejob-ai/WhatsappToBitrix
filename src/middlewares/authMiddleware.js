const { verifyToken } = require('../utils/jwt');
const { UserRepository } = require('../repositories/user.repository');
const AppError = require('../utils/AppError');
const { apiKeys } = require('../config');

const userRepo = new UserRepository();

/**
 * Extracts and verifies JWT or API Key authentication.
 * Attaches req.user if valid.
 */
async function authenticate(req, res, next) {
  try {
    // 1. Check Bearer Token or x-auth-token
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
    }

    if (token) {
      try {
        const decoded = verifyToken(token);
        if (decoded && decoded.id) {
          const user = await userRepo.findById(decoded.id);
          if (user && user.isActive) {
            req.user = {
              id: user.id,
              tenantId: user.tenantId,
              email: user.email,
              name: user.name,
              role: user.role,
              tenant: user.tenant,
            };
            return next();
          }
        }
      } catch (err) {
        // Invalid or expired token
      }
    }

    // 2. Check Legacy API Key (for backward compatibility)
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey && apiKeys.includes(apiKey)) {
      // Legacy super-admin / system client call
      req.user = {
        id: 0,
        tenantId: null, // Global / default tenant
        email: 'api-key@system.local',
        name: 'System API Key',
        role: 'SUPER_ADMIN',
        isApiKey: true,
      };
      return next();
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Enforces that a valid user is logged in.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new AppError('Authentication required. Please log in.', 401, null, 'UNAUTHORIZED'));
  }
  next();
}

/**
 * Enforces specific user roles (e.g. SUPER_ADMIN, TENANT_ADMIN).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, null, 'UNAUTHORIZED'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Forbidden: Access denied for your role', 403, null, 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = {
  authenticate,
  requireAuth,
  requireRole,
};
