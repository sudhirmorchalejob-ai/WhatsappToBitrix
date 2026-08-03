-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'PDF', 'LOCATION', 'CONTACT', 'STICKER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageState" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('WHATSBOX', 'BITRIX24');

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "whatsappPhone" VARCHAR(20) NOT NULL,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    "name" VARCHAR(255),
    "email" VARCHAR(255),
    "company" VARCHAR(255),
    "avatarUrl" VARCHAR(500),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3),
    "bitrix24ContactId" INTEGER,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "channelNumber" VARCHAR(20) NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "whatsappThreadId" VARCHAR(255),
    "bitrix24ThreadId" VARCHAR(255),
    "dealId" INTEGER,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" VARCHAR(500),
    "lastMessageDirection" "MessageDirection",
    "lastMessageType" "MessageType",
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "assignedAgentId" INTEGER,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "dealId" INTEGER,
    "whatsboxMessageId" VARCHAR(255),
    "wamid" VARCHAR(255),
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'UNKNOWN',
    "body" TEXT,
    "caption" VARCHAR(1000),
    "mediaUrl" VARCHAR(2000),
    "mediaMimeType" VARCHAR(255),
    "mediaName" VARCHAR(255),
    "mediaSize" INTEGER,
    "locationData" JSONB,
    "contactCard" JSONB,
    "payload" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MessageState" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "bitrix24UserId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "avatarUrl" VARCHAR(500),
    "whatsappChannelId" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'string',
    "description" VARCHAR(500),
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" SERIAL NOT NULL,
    "source" "WebhookSource" NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payload" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "httpCode" INTEGER,
    "errorMessage" TEXT,
    "ip" VARCHAR(50),
    "signature" VARCHAR(255),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_statuses" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "status" "MessageState" NOT NULL,
    "providerStatus" VARCHAR(50),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "raw" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "agentId" INTEGER NOT NULL,
    "assignedByAgentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_whatsappPhone_key" ON "contacts"("whatsappPhone");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_bitrix24ContactId_key" ON "contacts"("bitrix24ContactId");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "conversations_assignedAgentId_idx" ON "conversations"("assignedAgentId");

-- CreateIndex
CREATE INDEX "conversations_lastMessageAt_idx" ON "conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contactId_channelNumber_key" ON "conversations"("contactId", "channelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsboxMessageId_key" ON "messages"("whatsboxMessageId");

-- CreateIndex
CREATE INDEX "messages_conversationId_timestamp_idx" ON "messages"("conversationId", "timestamp");

-- CreateIndex
CREATE INDEX "messages_contactId_timestamp_idx" ON "messages"("contactId", "timestamp");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_bitrix24UserId_key" ON "agents"("bitrix24UserId");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "webhook_logs_source_createdAt_idx" ON "webhook_logs"("source", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_logs_status_idx" ON "webhook_logs"("status");

-- CreateIndex
CREATE INDEX "message_statuses_messageId_timestamp_idx" ON "message_statuses"("messageId", "timestamp");

-- CreateIndex
CREATE INDEX "conversation_assignments_conversationId_idx" ON "conversation_assignments"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_assignments_agentId_isActive_idx" ON "conversation_assignments"("agentId", "isActive");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_statuses" ADD CONSTRAINT "message_statuses_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
