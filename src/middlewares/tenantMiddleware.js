const { TenantRepository } = require('../repositories/tenant.repository');
const tenantRepo = new TenantRepository();

/**
 * Tenant resolution middleware.
 * Attaches req.tenantId (number or null) to the request object.
 */
async function tenantContext(req, res, next) {
  try {
    let tenantId = null;

    // 1. User token tenant
    if (req.user && req.user.tenantId !== null && req.user.tenantId !== undefined) {
      tenantId = Number(req.user.tenantId);
    }

    // 2. Header override (e.g. for Super Admin or Webhooks)
    const headerTenantId = req.headers['x-tenant-id'];
    if (headerTenantId) {
      tenantId = Number(headerTenantId);
    }

    // 3. Slug header lookup
    const headerTenantSlug = req.headers['x-tenant-slug'];
    if (!tenantId && headerTenantSlug) {
      const tenant = await tenantRepo.findBySlug(headerTenantSlug);
      if (tenant) {
        tenantId = tenant.id;
      }
    }

    req.tenantId = tenantId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  tenantContext,
};
