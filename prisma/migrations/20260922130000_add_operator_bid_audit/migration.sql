CREATE TYPE "BidSource" AS ENUM ('ONLINE', 'ON_SITE');

CREATE TABLE "OperatorAccess" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "auctionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorAccess_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Bid"
ADD COLUMN "source" "BidSource" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN "operatorAccessId" TEXT;

CREATE UNIQUE INDEX "OperatorAccess_codeHash_key" ON "OperatorAccess"("codeHash");
CREATE INDEX "OperatorAccess_auctionId_idx" ON "OperatorAccess"("auctionId");
CREATE INDEX "OperatorAccess_expiresAt_idx" ON "OperatorAccess"("expiresAt");
CREATE INDEX "Bid_operatorAccessId_idx" ON "Bid"("operatorAccessId");

ALTER TABLE "OperatorAccess" ADD CONSTRAINT "OperatorAccess_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_operatorAccessId_fkey" FOREIGN KEY ("operatorAccessId") REFERENCES "OperatorAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;
