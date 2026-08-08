-- Add the Bitrix24 lead id that mirrors a WhatsApp campaign in the CRM.
-- Only set for campaigns that were pushed to (or created from) Bitrix24.
ALTER TABLE "campaigns" ADD COLUMN "bitrix24LeadId" INTEGER;

CREATE INDEX "campaigns_bitrix24LeadId_idx" ON "campaigns"("bitrix24LeadId");
