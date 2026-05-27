-- Align Sale with the current Prisma schema.
ALTER TABLE "Sale"
ADD COLUMN "confirmedByMemberId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';

CREATE INDEX "Sale_confirmedByMemberId_idx" ON "Sale"("confirmedByMemberId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_confirmedByMemberId_fkey"
FOREIGN KEY ("confirmedByMemberId") REFERENCES "AuctionHouseMember"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
