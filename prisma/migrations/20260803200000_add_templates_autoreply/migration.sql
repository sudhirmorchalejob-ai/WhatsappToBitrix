-- CreateTable
CREATE TABLE "templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "category" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_reply_logs" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_reply_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_isActive_idx" ON "templates"("isActive");

-- CreateIndex
CREATE INDEX "templates_category_idx" ON "templates"("category");

-- CreateIndex
CREATE INDEX "auto_reply_logs_contactId_createdAt_idx" ON "auto_reply_logs"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "auto_reply_logs_conversationId_idx" ON "auto_reply_logs"("conversationId");

-- AddForeignKey
ALTER TABLE "auto_reply_logs" ADD CONSTRAINT "auto_reply_logs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_logs" ADD CONSTRAINT "auto_reply_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_logs" ADD CONSTRAINT "auto_reply_logs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_logs" ADD CONSTRAINT "auto_reply_logs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
