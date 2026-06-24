-- Drop the Auction.mode column and the enum type that only existed for it.
ALTER TABLE "Auction" DROP COLUMN "mode";

DROP TYPE "AuctionMode";
