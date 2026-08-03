-- CreateTable
CREATE TABLE "bitrix24_installs" (
    "id" SERIAL NOT NULL,
    "memberId" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "clientEndpoint" VARCHAR(500),
    "accessToken" VARCHAR(1024) NOT NULL,
    "refreshToken" VARCHAR(1024) NOT NULL,
    "applicationToken" VARCHAR(255),
    "userId" INTEGER,
    "scope" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'INSTALLED',
    "expiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitrix24_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bitrix24_installs_memberId_key" ON "bitrix24_installs"("memberId");

-- CreateIndex
CREATE INDEX "bitrix24_installs_status_updatedAt_idx" ON "bitrix24_installs"("status", "updatedAt");
