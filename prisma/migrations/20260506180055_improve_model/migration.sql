/*
  Warnings:

  - You are about to drop the column `ownerId` on the `Auction` table. All the data in the column will be lost.
  - You are about to drop the column `minPrice` on the `Lot` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[consignmentId]` on the table `Lot` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `auctionHouseId` to the `Auction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `Auction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuctionHouseRole" AS ENUM ('OWNER', 'MANAGER', 'AUCTIONEER', 'STAFF');

-- CreateEnum
CREATE TYPE "AuctionMode" AS ENUM ('LIVE', 'PRE_BID', 'TIMED', 'HYBRID');

-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "BuyerRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('VALID', 'OUTBID', 'CANCELED', 'WINNING');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('WAITING', 'LIVE', 'ENDED', 'ERROR');

-- CreateEnum
CREATE TYPE "CommercialUnit" AS ENUM ('PER_HEAD', 'PER_KG', 'PER_ARROBA', 'PER_POUND');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LotStatus" ADD VALUE 'DRAFT';
ALTER TYPE "LotStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "LotStatus" ADD VALUE 'APPROVED';
ALTER TYPE "LotStatus" ADD VALUE 'IN_AUCTION';
ALTER TYPE "LotStatus" ADD VALUE 'REJECTED';

-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Lot" DROP CONSTRAINT "Lot_auctionId_fkey";

-- DropIndex
DROP INDEX "Lot_auctionId_code_key";

-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "ownerId",
ADD COLUMN     "auctionHouseId" TEXT NOT NULL,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "mode" "AuctionMode" NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lot" DROP COLUMN "minPrice",
ADD COLUMN     "ageMonths" INTEGER,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "consignmentId" TEXT,
ADD COLUMN     "initialPrice" DECIMAL(12,2),
ADD COLUMN     "reservePrice" DECIMAL(12,2),
ADD COLUMN     "sex" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "auctionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
ADD COLUMN     "document" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "creditLimit" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruralRegistration" TEXT,
    "stateRegistration" TEXT,
    "farmName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionHouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuctionHouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionHouseMember" (
    "id" TEXT NOT NULL,
    "role" "AuctionHouseRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "auctionHouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuctionHouseMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionSettings" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "commercialUnit" "CommercialUnit" NOT NULL DEFAULT 'PER_HEAD',
    "minBidIncrement" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowPreBid" BOOLEAN NOT NULL DEFAULT false,
    "allowAutoExtension" BOOLEAN NOT NULL DEFAULT false,
    "autoExtensionSeconds" INTEGER,
    "hasReservePrice" BOOLEAN NOT NULL DEFAULT false,
    "requiresBuyerApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuctionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consignment" (
    "id" TEXT NOT NULL,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "sellerNotes" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "sellerId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "auctionHouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotMedia" (
    "id" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerRegistration" (
    "id" TEXT NOT NULL,
    "status" "BuyerRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "buyerId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'VALID',
    "bidderId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "status" "StreamStatus" NOT NULL DEFAULT 'WAITING',
    "streamUrl" TEXT,
    "protocol" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "auctionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "finalPrice" DECIMAL(12,2) NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'PENDING',
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "lotId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerProfile_userId_key" ON "BuyerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_userId_key" ON "SellerProfile"("userId");

-- CreateIndex
CREATE INDEX "AuctionHouseMember_auctionHouseId_idx" ON "AuctionHouseMember"("auctionHouseId");

-- CreateIndex
CREATE INDEX "AuctionHouseMember_userId_idx" ON "AuctionHouseMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionHouseMember_userId_auctionHouseId_key" ON "AuctionHouseMember"("userId", "auctionHouseId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionSettings_auctionId_key" ON "AuctionSettings"("auctionId");

-- CreateIndex
CREATE INDEX "Consignment_sellerId_idx" ON "Consignment"("sellerId");

-- CreateIndex
CREATE INDEX "Consignment_auctionHouseId_idx" ON "Consignment"("auctionHouseId");

-- CreateIndex
CREATE INDEX "Consignment_status_idx" ON "Consignment"("status");

-- CreateIndex
CREATE INDEX "LotMedia_lotId_idx" ON "LotMedia"("lotId");

-- CreateIndex
CREATE INDEX "BuyerRegistration_buyerId_idx" ON "BuyerRegistration"("buyerId");

-- CreateIndex
CREATE INDEX "BuyerRegistration_auctionId_idx" ON "BuyerRegistration"("auctionId");

-- CreateIndex
CREATE INDEX "BuyerRegistration_status_idx" ON "BuyerRegistration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerRegistration_buyerId_auctionId_key" ON "BuyerRegistration"("buyerId", "auctionId");

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE INDEX "Bid_lotId_idx" ON "Bid"("lotId");

-- CreateIndex
CREATE INDEX "Bid_lotId_createdAt_idx" ON "Bid"("lotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_auctionId_key" ON "Stream"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_lotId_key" ON "Sale"("lotId");

-- CreateIndex
CREATE INDEX "Sale_buyerId_idx" ON "Sale"("buyerId");

-- CreateIndex
CREATE INDEX "Auction_auctionHouseId_idx" ON "Auction"("auctionHouseId");

-- CreateIndex
CREATE INDEX "Auction_createdById_idx" ON "Auction"("createdById");

-- CreateIndex
CREATE INDEX "Auction_status_idx" ON "Auction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_consignmentId_key" ON "Lot"("consignmentId");

-- CreateIndex
CREATE INDEX "Lot_auctionId_idx" ON "Lot"("auctionId");

-- CreateIndex
CREATE INDEX "Lot_auctionId_code_idx" ON "Lot"("auctionId", "code");

-- CreateIndex
CREATE INDEX "Lot_status_idx" ON "Lot"("status");

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionHouseMember" ADD CONSTRAINT "AuctionHouseMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionHouseMember" ADD CONSTRAINT "AuctionHouseMember_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionSettings" ADD CONSTRAINT "AuctionSettings_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "AuctionHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_consignmentId_fkey" FOREIGN KEY ("consignmentId") REFERENCES "Consignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMedia" ADD CONSTRAINT "LotMedia_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerRegistration" ADD CONSTRAINT "BuyerRegistration_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerRegistration" ADD CONSTRAINT "BuyerRegistration_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerRegistration" ADD CONSTRAINT "BuyerRegistration_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
