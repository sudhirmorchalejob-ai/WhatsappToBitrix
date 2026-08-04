-- Rename dealId to leadId: the integration creates Bitrix24 leads, not deals.
ALTER TABLE "conversations" RENAME COLUMN "dealId" TO "leadId";
ALTER TABLE "messages" RENAME COLUMN "dealId" TO "leadId";
