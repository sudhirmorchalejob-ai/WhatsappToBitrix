-- Two-way WhatsApp campaign support.
--
-- * campaigns gain the audience segment the send targets.
-- * conversations are linked to the campaign that spawned them, so inbound
--   replies can be matched back to the campaign thread.
-- * campaign_recipients gains the full message lifecycle tracking needed for
--   delivery/read/reply states and for syncing outcomes back to Bitrix24.

-- Campaign segment fields
ALTER TABLE "campaigns" ADD COLUMN "segmentKey" VARCHAR(100),
  ADD COLUMN "segmentName" VARCHAR(255),
  ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "campaigns_segmentKey_idx" ON "campaigns"("segmentKey");

-- Conversation -> campaign link
ALTER TABLE "conversations" ADD COLUMN "campaignId" INTEGER;

CREATE INDEX "conversations_campaignId_idx" ON "conversations"("campaignId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Recipient tracking columns
ALTER TABLE "campaign_recipients" ADD COLUMN "contactId" INTEGER,
  ADD COLUMN "conversationId" INTEGER,
  ADD COLUMN "leadId" INTEGER,
  ADD COLUMN "messageId" INTEGER,
  ADD COLUMN "whatsappMessageId" VARCHAR(255),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "repliedAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Deduplicate legacy rows before enforcing the unique constraint
-- (campaignId, phone).
DELETE FROM "campaign_recipients" a
USING "campaign_recipients" b
WHERE a."campaignId" = b."campaignId"
  AND a.phone = b.phone
  AND a.id > b.id;

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_phone_key" ON "campaign_recipients"("campaignId", "phone");
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");
CREATE INDEX "campaign_recipients_phone_idx" ON "campaign_recipients"("phone");
CREATE INDEX "campaign_recipients_messageId_idx" ON "campaign_recipients"("messageId");
