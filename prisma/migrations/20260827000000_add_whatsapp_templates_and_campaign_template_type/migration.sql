-- AlterEnum
ALTER TYPE "CampaignType" ADD VALUE 'TEMPLATE';

-- AlterTable: Add template columns to campaigns
ALTER TABLE "campaigns" ADD COLUMN "templateName" VARCHAR(255),
ADD COLUMN "templateLanguage" VARCHAR(10),
ADD COLUMN "templateParams" JSONB;

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "templateName" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "bodyText" TEXT,
    "headerType" VARCHAR(20),
    "headerText" TEXT,
    "buttons" JSONB,
    "components" JSONB,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenantId_templateName_language_key" ON "whatsapp_templates"("tenantId", "templateName", "language");

-- CreateIndex
CREATE INDEX "whatsapp_templates_tenantId_idx" ON "whatsapp_templates"("tenantId");

-- CreateIndex
CREATE INDEX "whatsapp_templates_category_idx" ON "whatsapp_templates"("category");

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
