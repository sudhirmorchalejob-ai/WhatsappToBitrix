-- Origin of a contact row:
--   WHATSAPP      -> created/updated from a WhatsApp interaction (webhook)
--   BITRIX24_SYNC -> bulk-imported from the Bitrix24 pull-sync
-- This lets dashboard KPIs count customers/leads "created via WhatsApp only".
ALTER TABLE "contacts" ADD COLUMN "createdVia" VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP';

-- Backfill rows previously pulled from Bitrix24 (tagged in meta) so they
-- stay excluded from the WhatsApp-only dashboard KPIs.
UPDATE "contacts" SET "createdVia" = 'BITRIX24_SYNC' WHERE "meta"->>'source' = 'bitrix24-pull';
