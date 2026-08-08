-- AlterTable
-- The WhatsApp provider for a conversation (reuses the existing
-- WebhookSource enum: WHATSBOX | META) plus the Meta Cloud API phone
-- number id used when sending operator replies over the Meta provider.
ALTER TABLE "conversations" ADD COLUMN "provider" "WebhookSource" NOT NULL DEFAULT 'WHATSBOX';
ALTER TABLE "conversations" ADD COLUMN "phoneNumberId" VARCHAR(64);
