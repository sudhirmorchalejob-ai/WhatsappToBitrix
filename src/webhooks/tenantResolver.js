const { TenantRepository } = require('../repositories/tenant.repository');

/**
 * Builds a cached per-request resolver that maps a WhatsApp channel
 * phone number (the number that received the message) to the tenant
 * that owns it (tenant.whatsboxChannelId). Used by the WhatsBox and
 * Meta webhook controllers so inbound messages + webhook logs are
 * attributed to the correct tenant, which keeps the tenant-scoped
 * dashboard KPIs and webhook history accurate.
 */
function createTenantChannelResolver({ tenantRepo = new TenantRepository() } = {}) {
  const cache = new Map();

  return async function resolveTenantId(channelId) {
    if (channelId === null || channelId === undefined || channelId === '') return null;
    if (cache.has(channelId)) return cache.get(channelId);

    let tenantId = null;
    try {
      const tenant = await tenantRepo.findByWhatsboxChannelId(channelId);
      tenantId = tenant ? tenant.id : null;
    } catch {
      tenantId = null;
    }
    cache.set(channelId, tenantId);
    return tenantId;
  };
}

module.exports = { createTenantChannelResolver };
