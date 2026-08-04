-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "CampaignType" AS ENUM ('TEXT', 'MEDIA');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "campaignId" INTEGER;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'TEXT',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT,
    "mediaUrl" VARCHAR(2000),
    "mediaName" VARCHAR(255),
    "caption" VARCHAR(1000),
    "createdVia" VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_tenantId_idx" ON "campaigns"("tenantId");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_createdAt_idx" ON "campaigns"("createdAt");
CREATE INDEX "messages_campaignId_idx" ON "messages"("campaignId");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
