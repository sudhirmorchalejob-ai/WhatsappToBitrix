-- AlterEnum
ALTER TYPE "MessageState" ADD VALUE 'UNDELIVERED';

-- AlterEnum
ALTER TYPE "WebhookSource" ADD VALUE 'SMS';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "bitrixMessageId" VARCHAR(255),
ADD COLUMN     "provider" VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "providerMessageId" VARCHAR(255);

-- CreateIndex
CREATE INDEX "messages_provider_idx" ON "messages"("provider");

-- CreateIndex
CREATE INDEX "messages_providerMessageId_idx" ON "messages"("providerMessageId");
