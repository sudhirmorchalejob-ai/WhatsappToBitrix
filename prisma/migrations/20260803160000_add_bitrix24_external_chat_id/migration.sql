-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "bitrix24ExternalChatId" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_bitrix24ExternalChatId_key" ON "conversations"("bitrix24ExternalChatId");
