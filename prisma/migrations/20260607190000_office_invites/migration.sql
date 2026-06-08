CREATE TYPE "OfficeInviteStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED');

CREATE TABLE "OfficeInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "OfficeInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "auctionHouseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeInvite_token_key" ON "OfficeInvite"("token");
CREATE INDEX "OfficeInvite_email_idx" ON "OfficeInvite"("email");
CREATE INDEX "OfficeInvite_status_idx" ON "OfficeInvite"("status");
CREATE INDEX "OfficeInvite_expiresAt_idx" ON "OfficeInvite"("expiresAt");

ALTER TABLE "OfficeInvite" ADD CONSTRAINT "OfficeInvite_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
