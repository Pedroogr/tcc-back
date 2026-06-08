-- Buyer approvals are scoped to the auction house, not to a single auction.
ALTER TABLE "BuyerRegistration" DROP CONSTRAINT "BuyerRegistration_auctionId_fkey";

DROP INDEX "BuyerRegistration_buyerId_auctionId_key";
DROP INDEX "BuyerRegistration_auctionId_idx";

ALTER TABLE "BuyerRegistration" ADD COLUMN "auctionHouseId" TEXT;

UPDATE "BuyerRegistration"
SET "auctionHouseId" = "Auction"."auctionHouseId"
FROM "Auction"
WHERE "BuyerRegistration"."auctionId" = "Auction"."id";

DELETE FROM "BuyerRegistration"
WHERE "auctionHouseId" IS NULL;

ALTER TABLE "BuyerRegistration" ALTER COLUMN "auctionHouseId" SET NOT NULL;

-- If a buyer had requests in more than one auction from the same house, keep
-- the most recent one and drop the older duplicates before adding the new key.
DELETE FROM "BuyerRegistration" older
USING "BuyerRegistration" newer
WHERE older."buyerId" = newer."buyerId"
  AND older."auctionHouseId" = newer."auctionHouseId"
  AND (
    older."createdAt" < newer."createdAt"
    OR (older."createdAt" = newer."createdAt" AND older."id" < newer."id")
  );

ALTER TABLE "BuyerRegistration" DROP COLUMN "auctionId";

CREATE INDEX "BuyerRegistration_auctionHouseId_idx" ON "BuyerRegistration"("auctionHouseId");
CREATE UNIQUE INDEX "BuyerRegistration_buyerId_auctionHouseId_key" ON "BuyerRegistration"("buyerId", "auctionHouseId");

ALTER TABLE "BuyerRegistration" ADD CONSTRAINT "BuyerRegistration_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
