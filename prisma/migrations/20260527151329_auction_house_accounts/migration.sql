-- CreateEnum
CREATE TYPE "AuctionHouseStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING');

-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_createdById_fkey";

-- DropForeignKey
ALTER TABLE "AuctionHouseMember" DROP CONSTRAINT "AuctionHouseMember_auctionHouseId_fkey";

-- DropForeignKey
ALTER TABLE "AuctionHouseMember" DROP CONSTRAINT "AuctionHouseMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_confirmedByMemberId_fkey";

-- DropIndex
DROP INDEX "Auction_createdById_idx";

-- DropIndex
DROP INDEX "Sale_confirmedByMemberId_idx";

-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "createdById";

-- Existing auction houses receive a temporary login email/password so the new
-- required credentials can be applied without data loss.
UPDATE "AuctionHouse"
SET "email" = CONCAT('auction-house-', "id", '@local.invalid')
WHERE "email" IS NULL;

-- AlterTable
ALTER TABLE "AuctionHouse" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '$2b$10$TyAyd1ZqllGqJI8P15hSkefllqbN22nCk9fipxWKTRpzay.Ko6CUu',
ADD COLUMN     "status" "AuctionHouseStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE "AuctionHouse" ALTER COLUMN "passwordHash" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuctionSettings" DROP COLUMN "allowAutoExtension",
DROP COLUMN "allowPreBid",
DROP COLUMN "autoExtensionSeconds",
DROP COLUMN "hasReservePrice";

-- AlterTable
ALTER TABLE "Lot" DROP COLUMN "reservePrice";

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "confirmedByMemberId",
ADD COLUMN     "saleRecordedByAuctionHouseId" TEXT;

UPDATE "Sale"
SET "saleRecordedByAuctionHouseId" = "Auction"."auctionHouseId"
FROM "Lot"
JOIN "Auction" ON "Auction"."id" = "Lot"."auctionId"
WHERE "Sale"."lotId" = "Lot"."id";

UPDATE "Sale"
SET "saleRecordedByAuctionHouseId" = (
  SELECT "id" FROM "AuctionHouse" ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "saleRecordedByAuctionHouseId" IS NULL;

ALTER TABLE "Sale" ALTER COLUMN "saleRecordedByAuctionHouseId" SET NOT NULL;

-- DropTable
DROP TABLE "AuctionHouseMember";

-- DropEnum
DROP TYPE "AuctionHouseRole";

-- CreateIndex
CREATE UNIQUE INDEX "AuctionHouse_document_key" ON "AuctionHouse"("document");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionHouse_email_key" ON "AuctionHouse"("email");

-- CreateIndex
CREATE INDEX "Sale_saleRecordedByAuctionHouseId_idx" ON "Sale"("saleRecordedByAuctionHouseId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_saleRecordedByAuctionHouseId_fkey" FOREIGN KEY ("saleRecordedByAuctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
