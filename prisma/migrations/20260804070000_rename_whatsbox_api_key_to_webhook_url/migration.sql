-- The tenant's WhatsApp webhook URL was previously stored under a
-- provider-scoped "whatsboxApiKey" column. Rename it so the field name
-- reflects what it actually is: the WhatsApp webhook (URL) configured for
-- the tenant. Data is preserved; nothing else changes.
ALTER TABLE "tenants" RENAME COLUMN "whatsboxApiKey" TO "whatsappWebhookUrl";
