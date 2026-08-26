import { PrismaService } from '../../src/prisma/prisma.service';

const e2eTables = [
  'Sale',
  'Bid',
  'LotMedia',
  'Lot',
  'Consignment',
  'BuyerRegistration',
  'BuyerProfile',
  'SellerProfile',
  'AuctionSettings',
  'Stream',
  'Auction',
  'OfficeInvite',
  'AuctionHouse',
  'User',
];
const e2eDatabaseUrl =
  'postgresql://postgres:postgres@localhost:5435/cattle_auction_e2e';

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  if (process.env.DATABASE_URL !== e2eDatabaseUrl) {
    throw new Error('Refusing to reset a non-E2E database');
  }

  const tables = e2eTables.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
  );
}
